"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { encrypt } from "@/lib/crypto/secret-box";
import { getEncryptionKey } from "@/lib/env";
import { metaPageTokenName } from "@/lib/lead-source/secrets";
import { prisma } from "@/lib/prisma";
import { secretHint } from "@/lib/schemas/integration";
import { removeLeadSourceBindingSchema, saveLeadSourceBindingSchema } from "@/lib/schemas/lead-source";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (): void => revalidatePath("/configuracoes/integracoes");
const KIND = { google_ads: "google_ads_leads", meta: "meta_leads" } as const;
/** `@@unique([provider, externalAccountId])` é global: quem causa P2002 (fora da própria org) é outra org. */
const CLASH = "Este identificador já está vinculado a outra organização. Use outro google_key / ID de Página.";
const TOKEN_REQUIRED = "Informe o Page Access Token da Página: sem ele os dados do lead não são importados.";

type SaveOutcome = { kind: "ok"; id: string } | { kind: "needs_token" };

/**
 * Cria/atualiza (upsert) um vínculo conta-de-anúncios/Página -> campanha (D-041-3) e, no Meta, o
 * Page Access Token da Página no mesmo passo. O identificador É a credencial do Google Ads (o webhook
 * não tem HMAC), por isso não existe segredo global aqui — a resolução org/campanha é sempre este vínculo.
 *
 * `pageToken` vazio em edição mantém o atual; na criação do Meta é obrigatório (o handler devolve
 * `no_page_token` sem ele). Tudo numa transação Serializable (upsert + token + auditoria atômicos).
 */
export async function saveLeadSourceBinding(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireActiveProviderOrg();
    const parsed = saveLeadSourceBindingSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { provider, externalAccountId, label, campaignId, pageToken } = parsed.data;
    if (pageToken) {
      try {
        getEncryptionKey();
      } catch {
        return formError("ENCRYPTION_KEY não configurada/inválida no ambiente do servidor. Configure-a antes de cadastrar o Page Access Token.");
      }
    }
    const db = scopedPrisma(orgId);
    const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (!campaign) return failure({ campaignId: ["Campanha inválida."] });
    if (campaign.status === "archived") return failure({ campaignId: ["Essa campanha está arquivada. Escolha uma campanha que receba leads."] });

    let outcome: SaveOutcome;
    try {
      outcome = await withSerializableRetry(() =>
        prisma.$transaction(
          async (tx) => {
            const cur = await tx.leadSourceBinding.findFirst({ where: { provider, externalAccountId, orgId }, select: { id: true } });
            if (provider === "meta" && !pageToken && !cur) return { kind: "needs_token" } as const;
            const saved = cur
              ? await tx.leadSourceBinding.update({ where: { id: cur.id }, data: { campaignId, label: label ?? null }, select: { id: true } })
              : await tx.leadSourceBinding.create({ data: { orgId, campaignId, provider, externalAccountId, label: label ?? null }, select: { id: true } });

            let token: "none" | "created" | "rotated" = "none";
            if (provider === "meta" && pageToken) {
              const name = metaPageTokenName(externalAccountId);
              const where = { orgId_integration_name: { orgId, integration: "meta_leads" as const, name } };
              const curToken = await tx.integrationSecret.findUnique({ where, select: { id: true } });
              const data = { encryptedValue: encrypt(pageToken), hint: secretHint(pageToken), updatedById: actor.id, lastTestedAt: null, lastTestOk: null, lastTestError: null };
              if (curToken) {
                await tx.integrationSecret.update({ where: { id: curToken.id }, data });
                token = "rotated";
              } else {
                await tx.integrationSecret.create({ data: { orgId, integration: "meta_leads", name, ...data } });
                token = "created";
              }
            }

            // Auditoria: criação do vínculo + ciclo de vida do token. O enum IntegrationAuditAction não
            // tem "update" genérico — troca de campanha/rótulo não é segredo e fica sem linha de audit
            // (mesmo recorte do saveIntegration, que audita chave/URL, não metadados).
            const audits = [
              ...(!cur ? [{ action: "create" as const }] : []),
              ...(cur && token === "created" ? [{ action: "create" as const }] : []),
              ...(token === "rotated" ? [{ action: "rotate" as const }] : []),
            ];
            for (const a of audits) {
              await tx.integrationAuditLog.create({
                data: { orgId, userId: actor.id, integration: KIND[provider], action: a.action, hostMasked: null, allowPrivateHost: null },
              });
            }
            return { kind: "ok" as const, id: saved.id };
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return formError(CLASH);
      throw e;
    }
    if (outcome.kind === "needs_token") return failure({ pageToken: [TOKEN_REQUIRED] });
    revalidate();
    return success({ id: outcome.id });
  });
}

/**
 * Remove o vínculo (e o Page Access Token da página, se houver) na mesma transação — sem o vínculo o
 * token não tem uso (o webhook passa a responder `unknown_page`). Id de outra org vira "não encontrado".
 */
export async function removeLeadSourceBinding(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireActiveProviderOrg();
    const parsed = removeLeadSourceBindingSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const outcome = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const row = await tx.leadSourceBinding.findFirst({
            where: { id: parsed.data.id, orgId },
            select: { id: true, provider: true, externalAccountId: true },
          });
          if (!row) return { kind: "missing" } as const;
          await tx.leadSourceBinding.delete({ where: { id: row.id } });
          if (row.provider === "meta") {
            const name = metaPageTokenName(row.externalAccountId);
            const token = await tx.integrationSecret.findFirst({ where: { orgId, integration: "meta_leads", name }, select: { id: true } });
            if (token) await tx.integrationSecret.delete({ where: { id: token.id } });
          }
          await tx.integrationAuditLog.create({
            data: { orgId, userId: actor.id, integration: KIND[row.provider], action: "delete", hostMasked: null, allowPrivateHost: null },
          });
          return { kind: "ok" as const, id: row.id };
        },
        { isolationLevel: "Serializable" },
      ),
    );
    if (outcome.kind === "missing") return formError("Vínculo não encontrado.");
    revalidate();
    return success({ id: outcome.id });
  });
}
