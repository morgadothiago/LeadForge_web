"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { encrypt } from "@/lib/crypto/secret-box";
import { getEncryptionKey } from "@/lib/env";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { AppError } from "@/lib/errors";
import { invalidateIntegrationCache } from "@/lib/integrations/config";
import { assertAllowedHost, parseIntegrationUrl } from "@/lib/integrations/url-guard";
import { consumeSaveQuota, consumeTestQuota, runConnectionTest, type ConnectionTestResult } from "@/lib/integrations/test-connection";
import { hostOf, SELECT_ITEM, toItemView, type IntegrationItemView } from "@/lib/integrations/view";
import { INTEGRATION_LABEL, type IntegrationKindName } from "@/lib/integrations/types";
import { integrationIdSchema, removeIntegrationSchema, saveIntegrationSchema, secretHint } from "@/lib/schemas/integration";
import { decrypt } from "@/lib/crypto/secret-box";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (): void => revalidatePath("/configuracoes/integracoes");
const NOT_FOUND = "Integração não encontrada.";

/**
 * Salva (cria/atualiza/gira) uma integração. `value` é write-only: ausente/vazio em edição mantém a atual; obrigatório na criação.
 * Nunca devolve o valor. `allowPrivateHost=true` = confirmação "instância própria" (auditada); metadados/link-local nunca passam.
 */
export async function saveIntegration(input: unknown): Promise<ActionResult<IntegrationItemView>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireProviderOrg();
    const db = scopedPrisma(orgId);
    const saveWait = consumeSaveQuota(actor.id);
    if (saveWait > 0) return formError(`Muitas alterações seguidas. Tente novamente em ${saveWait}s.`);
    const parsed = saveIntegrationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { integration, name, value } = parsed.data;
    const where = { orgId_integration_name: { orgId, integration, name } };
    const existing = await db.integrationSecret.findUnique({ where });
    if (!existing && !value) return failure({ value: ["Informe a chave."] });
    if (value) {
      try {
        getEncryptionKey();
      } catch {
        return formError("ENCRYPTION_KEY não configurada/inválida no ambiente do servidor. Configure-a antes de cadastrar chaves.");
      }
    }
    const allowPrivateHost = parsed.data.allowPrivateHost ?? existing?.allowPrivateHost ?? false;
    let baseUrl: string | null = existing?.baseUrl ?? null;
    if (parsed.data.baseUrl) {
      try {
        baseUrl = parseIntegrationUrl(parsed.data.baseUrl).url;
      } catch (e) {
        if (e instanceof AppError) return failure({ baseUrl: [e.userMessage] });
        throw e;
      }
    }
    if (baseUrl) {
      try {
        await assertAllowedHost(parseIntegrationUrl(baseUrl).hostname, allowPrivateHost);
      } catch (e) {
        if (e instanceof AppError) return failure({ baseUrl: [e.userMessage] });
        throw e;
      }
    }
    const hostMasked = hostOf(baseUrl);
    const row = await withSerializableRetry(() =>
      prisma.$transaction(async (tx) => {
        const cur = await tx.integrationSecret.findUnique({ where });
        if ((cur?.updatedAt.getTime() ?? null) !== (existing?.updatedAt.getTime() ?? null)) {
          throw new AppError({ code: "conflict", userMessage: "A integração foi alterada por outra sessão. Recarregue e tente novamente." });
        }
        const urlChanged = !cur || cur.baseUrl !== baseUrl || cur.allowPrivateHost !== allowPrivateHost;
        const secret = value ? { encryptedValue: encrypt(value), hint: secretHint(value), lastTestedAt: null, lastTestOk: null, lastTestError: null } : {};
        const saved = cur
          ? await tx.integrationSecret.update({
              where: { id: cur.id },
              data: { ...secret, baseUrl, allowPrivateHost, updatedById: actor.id, ...(urlChanged && !value ? { lastTestedAt: null, lastTestOk: null, lastTestError: null } : {}) },
              select: SELECT_ITEM,
            })
          : await tx.integrationSecret.create({
              data: { orgId, integration, name, encryptedValue: encrypt(value as string), hint: secretHint(value as string), baseUrl, allowPrivateHost, updatedById: actor.id },
              select: SELECT_ITEM,
            });
        const audit = [
          ...(!cur ? [{ action: "create" as const }] : value ? [{ action: "rotate" as const }] : []),
          ...(cur && urlChanged ? [{ action: "update_url" as const }] : []),
        ];
        for (const a of audit) {
          await tx.integrationAuditLog.create({
            data: { orgId, userId: actor.id, integration, action: a.action, hostMasked, allowPrivateHost: baseUrl ? allowPrivateHost : null },
          });
        }
        return saved;
      }, { isolationLevel: "Serializable" }),
    );
    invalidateIntegrationCache(orgId);
    revalidate();
    return success(toItemView(row));
  });
}

/** Remove a chave do banco (o resolvedor volta ao fallback .env, se existir). Bloqueia se houver instâncias WhatsApp dependendo da Evolution. */
export async function removeIntegration(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireProviderOrg();
    const parsed = removeIntegrationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    // Contagem de dependentes + delete + auditoria na MESMA transação Serializable (sem janela entre checar e apagar).
    // P2025 (linha sumiu) é tratado por safeAction/handleActionError -> "Registro não encontrado."
    const outcome = await withSerializableRetry(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.integrationSecret.findFirst({ where: { id: parsed.data.id, orgId }, select: { id: true, integration: true, baseUrl: true } });
        if (!row) return { kind: "missing" as const };
        if (row.integration === "evolution") {
          const n = await tx.whatsAppInstance.count({ where: { orgId, provider: "evolution" } });
          if (n > 0) return { kind: "blocked" as const, n };
        }
        await tx.integrationSecret.delete({ where: { id: row.id } });
        await tx.integrationAuditLog.create({ data: { orgId, userId: actor.id, integration: row.integration, action: "delete", hostMasked: hostOf(row.baseUrl) } });
        return { kind: "ok" as const, id: row.id };
      }, { isolationLevel: "Serializable" }),
    );
    if (outcome.kind === "missing") return formError(NOT_FOUND);
    if (outcome.kind === "blocked") {
      const n = outcome.n;
      return formError(`Não é possível remover: ${n} instância${n > 1 ? "s" : ""} de WhatsApp ${n > 1 ? "dependem" : "depende"} da Evolution. Remova ${n > 1 ? "as instâncias" : "a instância"} antes.`);
    }
    invalidateIntegrationCache(orgId);
    revalidate();
    return success({ id: outcome.id });
  });
}

/** Testa a conexão (timeout, 429/Retry-After tratados, PT-BR). Limite: 5 testes/min por usuário. Atualiza lastTested*. */
export async function testIntegration(input: unknown): Promise<ActionResult<ConnectionTestResult>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireProviderOrg();
    const id = integrationIdSchema.safeParse(input);
    if (!id.success) return failure(zodErrors(id.error));
    const row = await prisma.integrationSecret.findFirst({ where: { id: id.data, orgId }, select: { id: true, integration: true, baseUrl: true, allowPrivateHost: true, encryptedValue: true } });
    if (!row) return formError(NOT_FOUND);
    const wait = consumeTestQuota(actor.id, row.id);
    if (wait > 0) return formError(`Muitos testes seguidos. Tente novamente em ${wait}s.`);
    const kind = row.integration as IntegrationKindName;
    let result: ConnectionTestResult;
    if (kind === "evolution") {
      invalidateIntegrationCache(orgId, kind, "default");
      result = await runConnectionTest(orgId, kind, { privateTarget: row.allowPrivateHost });
    } else {
      // Sem cliente ainda: valida só o formato (URL, se houver; segredo decifrável).
      try {
        decrypt(row.encryptedValue);
        if (row.baseUrl) parseIntegrationUrl(row.baseUrl);
        result = await runConnectionTest(orgId, kind);
      } catch {
        result = { available: false, ok: false, message: `Formato inválido em ${INTEGRATION_LABEL[kind]}. Salve a chave e a URL novamente.` };
      }
    }
    if (result.available) {
      // Defesa em profundidade: a mensagem nunca deve conter segredo; nada além de userMessage chega aqui.
      await prisma.$transaction([
        prisma.integrationSecret.update({ where: { id: row.id }, data: { lastTestedAt: new Date(), lastTestOk: result.ok, lastTestError: result.ok ? null : result.message.slice(0, 300) } }),
        prisma.integrationAuditLog.create({ data: { orgId, userId: actor.id, integration: row.integration, action: "test", hostMasked: hostOf(row.baseUrl) } }),
      ]);
    }
    revalidate();
    return success(result);
  });
}
