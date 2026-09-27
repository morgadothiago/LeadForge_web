"use server";

import { Prisma } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/require-admin";
import { adminPrisma } from "@/lib/tenant/admin-prisma";
import { createCourtesyOrganizationSchema, reactivateOrganizationSchema, suspendOrganizationSchema } from "@/lib/schemas/admin";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "@/lib/actions/result";
import { newResetToken, RESET_TOKEN_TTL_MS } from "@/lib/auth/password-reset";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { courtesyWelcomeTemplate } from "@/lib/channels/email/templates/courtesy-welcome";
import { safeErrorForLog } from "@/lib/errors";

/**
 * SPEC-031 — ações cross-tenant de `platform_admin` sobre `Organization.status` (suspender/reativar).
 * Sempre `requirePlatformAdmin()` + `adminPrisma` (nunca `scopedPrisma`/`requireProviderOrg`/
 * `requireActiveProviderOrg`) — o ator É a plataforma, não o dono da org. Não apaga dado nenhum: o
 * cron (SPEC-030, `runTick`) já para de processar orgs fora de `status: "active"`.
 *
 * Auditoria: `PlatformAuditLog` (novo model, decisão técnica desta SPEC — mesmo padrão de
 * `IntegrationAuditLog`/SPEC-018: 1 linha por ação, sem relation para `User` de propósito, para a
 * auditoria sobreviver mesmo que a conta do admin autor seja removida no futuro). Grava dentro da
 * MESMA transação do update de status, para nunca existir mudança de status sem o registro de "quem/
 * quando/ação/motivo" correspondente.
 */

export interface OrganizationStatusResult {
  orgId: string;
  status: "active" | "suspended";
}

const NOT_FOUND = "Organização não encontrada.";

const baseUrl = (): string => (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let n = 0;
  while (await adminPrisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

export interface CreateCourtesyOrganizationResult {
  orgId: string;
  userId: string;
}

/**
 * SPEC-040 (D-040-1/2/3/4) — cria manualmente uma Organization de cortesia com acesso completo e sem
 * cobrança real: User(`provider`)+Organization+Membership(owner)+Subscription (plano "courtesy",
 * `status: active`, SEM vínculo a checkout/PaymentProvider — `externalCustomerId`/`externalSubscriptionId`
 * ficam null, igual ao trial de `signUpAndStartCheckout` antes do 1º checkout; como nenhum checkout é
 * criado pra esta org, nenhum evento de webhook chega com o `orgId` dela — `processBillingEvent` nunca é
 * acionado por construção). PERMANENTE (D-040-1): sem prazo/expiração; revogação futura é
 * `suspendOrganization` (SPEC-031), já existente. Só `platform_admin` (D-040-4, `requirePlatformAdmin()`).
 *
 * Senha inicial: NÃO é definida pelo admin. Reaproveita a infra de "esqueci minha senha" (SPEC-038,
 * `PasswordResetToken`/`sendSystemEmail`) — gera um token de definição de senha e envia por e-mail ao
 * novo usuário, que define a própria senha em `/redefinir-senha`. Escolhido sobre "senha aleatória
 * temporária" porque reaproveita 100% da infraestrutura já existente (token model, página, rate limit
 * de uso do token) sem precisar transmitir/exibir segredo nenhum ao admin.
 */
export async function createCourtesyOrganization(input: unknown): Promise<ActionResult<CreateCourtesyOrganizationResult>> {
  return safeAction(async () => {
    const { user: admin } = await requirePlatformAdmin();
    const parsed = createCourtesyOrganizationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name, ownerEmail, ownerName } = parsed.data;

    const plan = await adminPrisma.plan.findUnique({ where: { key: "courtesy" }, select: { id: true } });
    if (!plan) return formError("Plano de cortesia não encontrado. Rode o seed de planos (prisma/seed.ts).");

    const slug = await uniqueSlug(name);
    const { token, hash } = newResetToken();

    let userId: string;
    let orgId: string;
    try {
      const created = await adminPrisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({ data: { name: ownerName, email: ownerEmail, role: "provider" }, select: { id: true } });
        const org = await tx.organization.create({ data: { name, slug, status: "active" }, select: { id: true } });
        await tx.membership.create({ data: { userId: newUser.id, orgId: org.id, orgRole: "owner" } });
        await tx.subscription.create({
          data: { orgId: org.id, planId: plan.id, status: "active", cadence: "monthly" },
        });
        await tx.passwordResetToken.create({
          data: { userId: newUser.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
        });
        await tx.platformAuditLog.create({
          data: { adminUserId: admin.id, orgId: org.id, action: "create_courtesy_org", reason: `conta de cortesia criada para ${ownerEmail}` },
        });
        return { userId: newUser.id, orgId: org.id };
      });
      userId = created.userId;
      orgId = created.orgId;
    } catch (e) {
      // Admin já autenticado/autorizado criando a conta (sem risco de enumeração aqui, diferente de
      // `signUpAndStartCheckout`) — mensagem direta é aceitável e mais útil.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return formError("Já existe uma conta cadastrada com este e-mail.");
      }
      throw e;
    }

    const link = `${baseUrl()}/redefinir-senha?token=${token}`;
    const { subject, html, text } = courtesyWelcomeTemplate({ link });
    void sendSystemEmail(ownerEmail, subject, { html, text }, "courtesy_welcome").then((r) => {
      if (!r.ok) console.error("[createCourtesyOrganization] falha ao enviar e-mail:", safeErrorForLog(r.error));
    });

    return success({ orgId, userId });
  });
}

export async function suspendOrganization(input: unknown): Promise<ActionResult<OrganizationStatusResult>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const parsed = suspendOrganizationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { orgId, reason } = parsed.data;
    const org = await adminPrisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) return formError(NOT_FOUND);
    await adminPrisma.$transaction([
      // SPEC-039 (correção QA, D-039-1): grava `suspendedReason: "manual"` explicitamente — é o sinal que
      // `reminders.ts` usa para NUNCA disparar o e-mail `auto_suspended` nesta suspensão, mesmo que a
      // `Subscription` também esteja em `past_due` com grace expirado por coincidência.
      adminPrisma.organization.update({ where: { id: orgId }, data: { status: "suspended", suspendedReason: "manual" } }),
      adminPrisma.platformAuditLog.create({ data: { adminUserId: user.id, orgId, action: "suspend", reason } }),
    ]);
    return success({ orgId, status: "suspended" as const });
  });
}

export async function reactivateOrganization(input: unknown): Promise<ActionResult<OrganizationStatusResult>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const parsed = reactivateOrganizationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { orgId } = parsed.data;
    const org = await adminPrisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) return formError(NOT_FOUND);
    await adminPrisma.$transaction([
      // SPEC-039 (correção QA): limpa `suspendedReason` — a org não está mais suspensa por nenhum motivo.
      adminPrisma.organization.update({ where: { id: orgId }, data: { status: "active", suspendedReason: null } }),
      adminPrisma.platformAuditLog.create({ data: { adminUserId: user.id, orgId, action: "reactivate" } }),
    ]);
    return success({ orgId, status: "active" as const });
  });
}
