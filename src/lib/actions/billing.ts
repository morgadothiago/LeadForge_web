"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { Prisma, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireProviderOrg } from "@/lib/auth/require-admin";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getClientIpKey } from "@/lib/auth/client-ip";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { getPaymentProvider } from "@/lib/billing/provider-factory";
import { processBillingEvent } from "@/lib/billing/process-event";
import { TRIAL_DAYS } from "@/lib/billing/status-map";
import { cancelModeFor } from "@/lib/billing/cancel-mode";
import { sendTrialStartedEmail } from "@/lib/billing/trial-email";
import { sendSignupEmails } from "@/lib/auth/email-verification";
import { checkoutSchema, signupSchema } from "@/lib/schemas/billing";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-033 — actions de billing. `createCheckoutSession`/`createPortalSession` usam `requireProviderOrg()`
 * (NÃO `requireActiveProviderOrg()`): precisam funcionar mesmo com a org `suspended`/`cancelled`, para o
 * owner conseguir REATIVAR a assinatura (D-33-3/D-33-4). `signUpAndStartCheckout` é pública (sem sessão
 * prévia, como `login`/`logout`) — nasce aqui para a SPEC-034 (signup self-service) consumir.
 */

const baseUrl = (): string => (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
const signupLimiter = new SlidingLimiter(5, 10 * 60_000);

/** Só o `owner` (Membership.orgRole) da org gerencia a assinatura — `member` não inicia checkout nem abre o portal. */
async function requireOwner(): Promise<{ orgId: string; userId: string }> {
  const { user, orgId } = await requireProviderOrg();
  const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } });
  if (membership?.orgRole !== "owner") throw new ForbiddenError();
  return { orgId, userId: user.id };
}

export async function createCheckoutSession(input: unknown): Promise<ActionResult<{ url: string }>> {
  return safeAction(async () => {
    const { orgId, userId } = await requireOwner();
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const provider = getPaymentProvider();
    const result = await provider.createCheckoutSession({
      orgId,
      planKey: parsed.data.planKey,
      cadence: parsed.data.cadence,
      customerEmail: user.email,
      successUrl: `${baseUrl()}/configuracoes/assinatura?checkout=success`,
      cancelUrl: `${baseUrl()}/configuracoes/assinatura?checkout=cancel`,
    });
    return success({ url: result.url });
  });
}

export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  return safeAction(async () => {
    const { orgId } = await requireOwner();
    const provider = getPaymentProvider();
    const result = await provider.createPortalSession({ orgId, returnUrl: `${baseUrl()}/configuracoes/assinatura` });
    return success({ url: result.url });
  });
}

const cancelLimiter = new SlidingLimiter(5, 10 * 60_000);

/** Estado devolvido ao frontend (053b): `cancelAtPeriodEnd` + `currentPeriodEnd` (fim do acesso) + `status`. */
export interface SubscriptionChangeResult {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** `scheduled` = cancelamento agendado p/ fim do periodo; `immediate` = efetivado agora (trial/sem periodo pago); `already` = nada a fazer (idempotente); `reactivated` = cancelamento agendado desfeito. */
  outcome: "scheduled" | "immediate" | "already" | "reactivated";
}

/**
 * SPEC-053a (D-053-1..6) — cancelar a assinatura da org ativa. Owner-only, rate limit, SEM senha (modal no front).
 * Plano pago em dia: `cancelAtPeriodEnd=true`, acesso ate `currentPeriodEnd`, sem reembolso. Trial (ou sem periodo
 * pago vigente): efetivo imediato (D-053-3). Provedor primeiro: se o provedor FALHAR (lanca), nada e gravado localmente
 * (o usuario tenta de novo, sem divergencia). Provedor sem endpoint (AbacatePay cartao/PIX) => fallback local
 * (D-053-5). Estado aplicado pelo MESMO `processBillingEvent`/`status-map.ts`. Idempotente.
 */
export async function cancelSubscription(): Promise<ActionResult<SubscriptionChangeResult>> {
  return safeAction(async () => {
    const { orgId } = await requireOwner();
    if (cancelLimiter.hit(orgId) > 0) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    const sub = await prisma.subscription.findUnique({
      where: { orgId },
      select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, externalCustomerId: true, externalSubscriptionId: true, plan: { select: { key: true } } },
    });
    if (!sub) return formError("Nenhuma assinatura encontrada para cancelar.");
    if (sub.status === "canceled" || sub.cancelAtPeriodEnd) {
      return success({ status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodEnd: sub.currentPeriodEnd, outcome: "already" });
    }
    const now = new Date();
    const atPeriodEnd = cancelModeFor(sub, now) === "scheduled";
    await getPaymentProvider().cancelSubscription({ orgId, atPeriodEnd });
    const result = await processBillingEvent(
      {
        eventId: `app_cancel:${orgId}:${randomUUID()}`,
        type: atPeriodEnd ? "subscription.updated" : "subscription.canceled",
        orgId,
        planKey: sub.plan.key,
        cadence: sub.cadence,
        status: atPeriodEnd ? sub.status : "canceled",
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: atPeriodEnd,
        externalCustomerId: sub.externalCustomerId,
        externalSubscriptionId: sub.externalSubscriptionId,
      },
      now,
    );
    if (result === "org_not_found" || result === "plan_not_found") return formError("Não foi possível cancelar a assinatura.");
    return success({ status: atPeriodEnd ? sub.status : "canceled", cancelAtPeriodEnd: atPeriodEnd, currentPeriodEnd: sub.currentPeriodEnd, outcome: atPeriodEnd ? "scheduled" : "immediate" });
  });
}

/**
 * SPEC-053a (D-053-4/6) — desfaz o cancelamento AGENDADO antes do fim do periodo (acesso nunca foi interrompido).
 * Assinatura ja efetivada (`canceled`/periodo vencido): reativar = nova contratacao via `createCheckoutSession`
 * (dados mantidos ate o expurgo, D-053-4); esta action recusa com mensagem. Idempotente (sem cancelamento
 * agendado => `already`, sem e-mail).
 */
export async function reactivateSubscription(): Promise<ActionResult<SubscriptionChangeResult>> {
  return safeAction(async () => {
    const { orgId } = await requireOwner();
    if (cancelLimiter.hit(orgId) > 0) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    const sub = await prisma.subscription.findUnique({
      where: { orgId },
      select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, externalCustomerId: true, externalSubscriptionId: true, plan: { select: { key: true } } },
    });
    if (!sub) return formError("Nenhuma assinatura encontrada.");
    const now = new Date();
    if (sub.status === "canceled" || (sub.cancelAtPeriodEnd && (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() <= now.getTime()))) {
      return formError("O cancelamento já foi efetivado. Contrate um plano novamente em Configurações > Assinatura para reativar.");
    }
    if (!sub.cancelAtPeriodEnd) {
      return success({ status: sub.status, cancelAtPeriodEnd: false, currentPeriodEnd: sub.currentPeriodEnd, outcome: "already" });
    }
    await getPaymentProvider().resumeSubscription({ orgId });
    const result = await processBillingEvent(
      {
        eventId: `app_reactivate:${orgId}:${randomUUID()}`,
        type: "subscription.updated",
        orgId,
        planKey: sub.plan.key,
        cadence: sub.cadence,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        explicitReactivation: true,
        externalCustomerId: sub.externalCustomerId,
        externalSubscriptionId: sub.externalSubscriptionId,
      },
      now,
    );
    if (result === "org_not_found" || result === "plan_not_found") return formError("Não foi possível reativar a assinatura.");
    return success({ status: sub.status, cancelAtPeriodEnd: false, currentPeriodEnd: sub.currentPeriodEnd, outcome: "reactivated" });
  });
}

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
  while (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

/**
 * SPEC-033/D-35-1 — signup self-service: cria User+Organization+Membership(owner)+Subscription(trialing,
 * 14 dias sem cartão, D-33-3) numa única transação, autentica (cria sessão) e devolve `redirectTo`. Ação
 * PÚBLICA (sem `requireUser`, como `login`) — allowlisted em `src/lib/use-server-auth.test.ts`.
 */
export async function signUpAndStartCheckout(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    const ip = getClientIpKey(await headers());
    const wait = signupLimiter.hit(ip);
    if (wait > 0) return formError(`Muitas tentativas. Tente novamente em ${wait}s.`);

    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name, email, password, orgName, planKey } = parsed.data;

    const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true, name: true, active: true, selfServiceCheckout: true } });
    if (!plan || !plan.active || !plan.selfServiceCheckout) {
      return failure({ planKey: ["Este plano não está disponível para assinatura self-service. Fale com vendas."] });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 3600_000);
    const slug = await uniqueSlug(orgName);

    let userId: string;
    let orgId: string;
    try {
      const created = await prisma.$transaction(async (tx) => {
        // SPEC-055 (D-055-3): cadastro self-service nasce NAO verificado (o default do banco e "verificado").
        const user = await tx.user.create({ data: { name, email, role: "provider", passwordHash, emailVerifiedAt: null }, select: { id: true } });
        const org = await tx.organization.create({ data: { name: orgName, slug, status: "active" }, select: { id: true } });
        await tx.membership.create({ data: { userId: user.id, orgId: org.id, orgRole: "owner" } });
        await tx.subscription.create({
          data: { orgId: org.id, planId: plan.id, status: "trialing", cadence: "monthly", trialEndsAt },
        });
        return { userId: user.id, orgId: org.id };
      });
      userId = created.userId;
      orgId = created.orgId;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // QA fix (achado menor, SPEC-033 rodada 2): mensagem genérica, sem confirmar que o e-mail já existe
        // (evita enumeração de contas num endpoint público só protegido por rate limit de IP).
        return formError("Não foi possível concluir o cadastro com os dados informados. Verifique as informações e tente novamente, ou entre em contato com o suporte.");
      }
      throw e;
    }

    // SPEC-055: boas-vindas (idempotente) + verificacao de e-mail, pos-commit/best-effort. Nunca no ramo de e-mail duplicado (anti-enumeracao).
    await sendSignupEmails({ id: userId, name, email }, { verify: true });
    await sendTrialStartedEmail(orgId, plan.name, trialEndsAt);
    await createSession(userId, orgId, "provider");
    return success({ redirectTo: "/dashboard" });
  });
}
