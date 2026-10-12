"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireProviderOrg, requireProviderOrgAllowExpired, requireProviderUser } from "@/lib/auth/require-admin";
import { requireUser } from "@/lib/auth/require-user";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getClientIpKey } from "@/lib/auth/client-ip";
import { loadAccountStage, type LoadedAccountStage } from "@/lib/auth/account-stage";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { getPaymentProvider } from "@/lib/billing/provider-factory";
import { processBillingEvent } from "@/lib/billing/process-event";
import { computeOrgStatus } from "@/lib/billing/status-map";
import { isBillingUnavailableError } from "@/lib/billing/provider-errors";
import { cancelLimiter, cancelSubscriptionForOrg, type SubscriptionChangeResult } from "@/lib/billing/cancel-subscription";
import { SHELL_NAME, findUserShell, lockUser } from "@/lib/billing/shell";
import { sendSignupEmails } from "@/lib/auth/email-verification";
import { parseDocument } from "@/lib/domain/document";
import { createTrialAccount } from "@/lib/billing/signup-trial";
import { isDisposableEmailDomain, isKnownIp, trialIpLimiter } from "@/lib/billing/trial-claim";
import { lockOrg } from "@/lib/org/guards";
import { recordOrgAudit } from "@/lib/org/audit";
import { createOrgLimiter } from "@/lib/org/rate-limit";
import { uniqueOrgSlug } from "@/lib/org/slug";
import { isAppError, safeErrorForLog } from "@/lib/errors";
import { checkoutSchema, completeOrgSetupSchema, renameOrgSchema, signupSchema } from "@/lib/schemas/billing";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-033 — actions de billing. `createCheckoutSession`/`createPortalSession` usam `requireProviderOrg()`
 * (NÃO `requireActiveProviderOrg()`): precisam funcionar mesmo com a org `suspended`/`cancelled`, para o
 * owner conseguir REATIVAR a assinatura (D-33-3/D-33-4). Servem a ORGANIZAÇÃO REAL (upgrade/reativar).
 *
 * SPEC-062 — cadastro só com usuário + plano obrigatório: `signUp` (pública), `startPlanCheckout`,
 * `getPlanCheckoutState`, `getAccountStage`, `cancelPendingSubscription`, `completeOrganizationSetup`
 * (todas `requireProviderUser`: o usuário ainda pode não ter organização). O pagamento do usuário sem org liga-se a uma
 * "casca de cobrança" (`Organization.setupPendingSince`, D-062-5; ver `src/lib/billing/shell.ts`).
 */

const baseUrl = (): string => (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
const signupLimiter = new SlidingLimiter(5, 10 * 60_000, 1000, "billing-signup");

/** Só o `owner` (Membership.orgRole) da org gerencia a assinatura — `member` não inicia checkout nem abre o portal. */
/** SPEC-065 (D-065-13.2): `allowExpired` SO para checkout/portal/reativar (a org com trial expirado precisa conseguir pagar). */
async function requireOwner(opts: { allowExpired?: boolean } = {}): Promise<{ orgId: string; userId: string }> {
  const { user, orgId } = await (opts.allowExpired ? requireProviderOrgAllowExpired() : requireProviderOrg());
  const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } });
  if (membership?.orgRole !== "owner") throw new ForbiddenError();
  return { orgId, userId: user.id };
}

export async function createCheckoutSession(input: unknown): Promise<ActionResult<{ url: string }>> {
  return safeAction(async () => {
    const { orgId, userId } = await requireOwner({ allowExpired: true });
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const provider = getPaymentProvider();
    try {
      const result = await provider.createCheckoutSession({
        orgId,
        planKey: parsed.data.planKey,
        cadence: parsed.data.cadence,
        customerEmail: user.email,
        successUrl: `${baseUrl()}/configuracoes/assinatura?checkout=success`,
        cancelUrl: `${baseUrl()}/configuracoes/assinatura?checkout=cancel`,
      });
      return success({ url: result.url });
    } catch (e) {
      // SPEC-063 (D-063-24): erro de configuracao/contrato do provedor nao e culpa do usuario.
      if (isBillingUnavailableError(e)) {
        console.error("[createCheckoutSession] falha ao abrir checkout:", safeErrorForLog(e));
        return formError(BILLING_UNAVAILABLE);
      }
      throw e;
    }
  });
}

export async function createPortalSession(): Promise<ActionResult<{ url: string }>> {
  return safeAction(async () => {
    const { orgId } = await requireOwner({ allowExpired: true });
    const provider = getPaymentProvider();
    const result = await provider.createPortalSession({ orgId, returnUrl: `${baseUrl()}/configuracoes/assinatura` });
    return success({ url: result.url });
  });
}

export type { SubscriptionChangeResult };

/**
 * SPEC-053a (D-053-1..6) — cancelar a assinatura da org ativa. Owner-only, rate limit, SEM senha (modal no front).
 * O miolo (plano pago em dia = agendado; sem periodo pago = imediato; provedor primeiro; idempotente) vive em
 * `cancelSubscriptionForOrg` (SPEC-062: reaproveitado por `cancelPendingSubscription`, sem mudar o comportamento da 053).
 */
export async function cancelSubscription(): Promise<ActionResult<SubscriptionChangeResult>> {
  return safeAction(async () => {
    const { orgId } = await requireOwner(); // SPEC-065: NAO e AllowExpired (cancelar => canceled => soft_blocked devolveria leitura sem pagar)
    return cancelSubscriptionForOrg(orgId);
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
    const { orgId } = await requireOwner({ allowExpired: true });
    if (await cancelLimiter.hit(orgId) > 0) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
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

const PLAN_UNAVAILABLE = "Este plano não está disponível para assinatura self-service. Fale com vendas.";
const BILLING_UNAVAILABLE = "Pagamento indisponível no momento. Tente novamente mais tarde.";
const EMAIL_UNVERIFIED = "Confirme seu e-mail antes de assinar. Enviamos um link de confirmação para o seu endereço de cadastro.";

/** Plano self-service ativo (D-062-7/10): `business`/`courtesy`/inativo => null. */
async function findSelfServicePlan(planKey: string): Promise<{ id: string; key: string } | null> {
  const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true, key: true, active: true, selfServiceCheckout: true } });
  return plan && plan.active && plan.selfServiceCheckout ? { id: plan.id, key: plan.key } : null;
}

/**
 * SPEC-065 (D-065-23/27) — cadastro: cria `User` + `Organization` (owner) + `Subscription(free, trialing, +14 dias)` + 2 `TrialClaim`
 * (e-mail canonico e CPF/CNPJ) numa UNICA transacao (`createTrialAccount`) e autentica ja na organizacao (`orgId` real), mandando ao
 * `/dashboard`. Substitui a D-062-1/7 (cadastro so com usuario). `document` (CPF ou CNPJ) e OBRIGATORIO e validado (digitos verificadores,
 * sequencia repetida); so o HASH e guardado. Se o e-mail canonico OU o documento (CNPJ pela raiz de 8 digitos) ja usou o teste, ou ha
 * IP acima de 3 trials/24 h, ou dominio descartavel: a conta E criada mas o trial nasce ja expirado (mensagem generica na tela de bloqueio,
 * sem revelar qual dado bateu). `?plan=&cadence=` da landing so pre-seleciona o botao de upgrade (nunca abre checkout). Ação PÚBLICA (como
 * `login`): allowlisted em `src/lib/use-server-auth.test.ts`. E-mail já existente: mensagem genérica e nenhum e-mail (J11 segue aberta).
 */
export async function signUp(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    const ip = getClientIpKey(await headers());
    const wait = await signupLimiter.hit(ip);
    if (wait > 0) return formError(`Muitas tentativas. Tente novamente em ${wait}s.`);

    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name, email, password, plan, cadence } = parsed.data;
    const document = parseDocument(parsed.data.document)!; // validado pelo schema

    // Intenção de plano vinda da landing: só vale se for plano self-service ativo; qualquer outra coisa é ignorada. Nunca abre checkout.
    const intent = plan ? await findSelfServicePlan(plan) : null;
    const redirectTo = intent ? `/dashboard?plan=${encodeURIComponent(intent.key)}&cadence=${cadence ?? "monthly"}` : "/dashboard";

    // D-065-19.4/5: teto de 3 trials novos por IP/24 h e dominio descartavel => conta sem trial (mesmo caminho do "ja usado").
    const ipKnown = isKnownIp(ip);
    const denyTrial = isDisposableEmailDomain(email) || (ipKnown && (await trialIpLimiter.peek(ip)) > 0);

    const passwordHash = await hashPassword(password);
    let created;
    try {
      created = await createTrialAccount({ name, email, passwordHash, document, denyTrial });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Mensagem genérica, sem confirmar que o e-mail já existe (anti-enumeração; endpoint público só com rate limit de IP).
        return formError("Não foi possível concluir o cadastro com os dados informados. Verifique as informações e tente novamente, ou entre em contato com o suporte.");
      }
      throw e;
    }
    if (created.trialGranted && ipKnown) await trialIpLimiter.hit(ip);

    // SPEC-055/065: boas-vindas (com o texto do trial) + verificacao de e-mail, pos-commit/best-effort. Nunca no ramo de e-mail duplicado.
    await sendSignupEmails({ id: created.userId, name, email }, { verify: true, hasOrg: true, ...(created.trialGranted ? { trialEndsAt: created.trialEndsAt } : {}) });
    await createSession(created.userId, created.orgId, "provider");
    return success({ redirectTo });
  });
}

/**
 * SPEC-065 (D-065-22) — renomeia a organizacao da sessao (cartao "Como se chama a sua empresa?" e Configuracoes). So o OWNER; rate limit;
 * `OrgAuditLog org_renamed`. O slug NAO muda (estavel para URLs/convites).
 */
export async function renameOrganization(input: unknown): Promise<ActionResult<{ name: string }>> {
  return safeAction(async () => {
    const { orgId, userId } = await requireOwner();
    const parsed = renameOrgSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    if (await createOrgLimiter.hit(`rename:${orgId}`) > 0) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    await prisma.$transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const before = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
      await tx.organization.update({ where: { id: orgId }, data: { name: parsed.data.name } });
      await recordOrgAudit(tx, { orgId, actorUserId: userId, action: "org_renamed", meta: { from: before.name, to: parsed.data.name } });
    });
    return success({ name: parsed.data.name });
  });
}

/** SPEC-062 (D-062-6) — estado derivado e destino do usuário logado (provider ou admin). Sem input. */
export async function getAccountStage(): Promise<ActionResult<LoadedAccountStage>> {
  return safeAction(async () => {
    const user = await requireUser();
    return success(await loadAccountStage(user.id, user.platformRole));
  });
}

/**
 * SPEC-062 (D-062-10/11/12/24) — início do checkout do usuário SEM organização. `requireProviderUser`; só cartão (sem `method`).
 * Sob lock de linha do `User` (no máximo 1 casca por usuário; duplo clique/duas abas reaproveitam a mesma):
 * (a) sem casca -> cria casca (`setupPendingSince`) + `Membership(owner)` + `Subscription(incomplete)` no plano escolhido;
 * (b) casca não paga (`incomplete`/`canceled`/`past_due`) -> troca plano/cadência e abre novo checkout;
 * (c) casca JÁ PAGA (`active`) -> não abre 2º checkout: `{ redirectTo: "/organizacao/nova" }`.
 * Recusas com `code`: `email_unverified` (D-062-12), `plan_unavailable`, `rate_limited`, `billing_unavailable` (inclui mock em produção, D-062-23).
 */
export async function startPlanCheckout(input: unknown): Promise<ActionResult<{ url: string } | { redirectTo: string }>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser();
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { planKey, cadence } = parsed.data;

    if (!user.emailVerified) return { ok: false, errors: { _form: [EMAIL_UNVERIFIED], code: ["email_unverified"] } };
    const plan = await findSelfServicePlan(planKey);
    if (!plan) return { ok: false, errors: { planKey: [PLAN_UNAVAILABLE], _form: [PLAN_UNAVAILABLE], code: ["plan_unavailable"] } };
    if (await createOrgLimiter.hit(`user:${user.id}`) > 0) {
      return { ok: false, errors: { _form: ["Muitas tentativas. Aguarde alguns minutos e tente novamente."], code: ["rate_limited"] } };
    }

    // Provedor ANTES de criar qualquer estado: mock em produção / provedor sem chaves => nenhuma casca é criada.
    let provider;
    try {
      provider = getPaymentProvider();
    } catch (e) {
      if (isAppError(e) && e.code === "config") {
        console.error("[startPlanCheckout] provedor de cobranca indisponivel:", safeErrorForLog(e));
        return { ok: false, errors: { _form: [BILLING_UNAVAILABLE], code: ["billing_unavailable"] } };
      }
      throw e;
    }

    const prepared = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id);
      const shell = await findUserShell(tx, user.id);
      if (shell?.subscriptionStatus === "active") return { kind: "paid" as const };
      if (shell) {
        await tx.subscription.update({ where: { orgId: shell.orgId }, data: { planId: plan.id, cadence } });
        return { kind: "checkout" as const, orgId: shell.orgId };
      }
      const orgId = randomUUID();
      // Casca nasce `suspended` (computeOrgStatus(incomplete)) e invisivel: nome provisorio, slug `pendente-<id8>`.
      await tx.organization.create({ data: { id: orgId, name: SHELL_NAME, slug: `pendente-${orgId.slice(0, 8)}`, status: "suspended", suspendedReason: "automatic", setupPendingSince: new Date() } });
      await tx.membership.create({ data: { userId: user.id, orgId, orgRole: "owner" } });
      await tx.subscription.create({ data: { orgId, planId: plan.id, status: "incomplete", cadence } });
      return { kind: "checkout" as const, orgId };
    });
    if (prepared.kind === "paid") return success({ redirectTo: "/organizacao/nova" });

    try {
      const result = await provider.createCheckoutSession({
        orgId: prepared.orgId,
        planKey: plan.key,
        cadence,
        customerEmail: user.email,
        successUrl: `${baseUrl()}/assinar/retorno`,
        cancelUrl: `${baseUrl()}/assinar?checkout=cancel`,
      });
      return success({ url: result.url });
    } catch (e) {
      // SPEC-063 (D-063-24): inclui validation/unauthorized/forbidden/not_found/conflict VINDOS do provedor (config/contrato nosso, nao do usuario).
      if (isBillingUnavailableError(e)) {
        // Casca incompleta permanece valida (estado "aguardando"): o usuario tenta de novo, mesma casca.
        console.error("[startPlanCheckout] falha ao abrir checkout:", safeErrorForLog(e));
        return { ok: false, errors: { _form: [BILLING_UNAVAILABLE], code: ["billing_unavailable"] } };
      }
      throw e;
    }
  });
}

export interface PlanCheckoutState {
  status: "none" | "incomplete" | "active" | "past_due" | "canceled";
  planKey?: string;
  cadence?: "monthly" | "yearly";
  emailVerified: boolean;
}

/**
 * SPEC-062 (D-062-11) — a VERDADE é a `Subscription` da casca (atualizada só pelo webhook via `processBillingEvent`), nunca a URL
 * de retorno. O `/assinar/retorno` faz polling nisto. Sem casca => `none`.
 */
export async function getPlanCheckoutState(): Promise<ActionResult<PlanCheckoutState>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser();
    const shell = await findUserShell(prisma, user.id);
    const s = shell?.subscriptionStatus;
    const status: PlanCheckoutState["status"] = s === "incomplete" || s === "active" || s === "past_due" || s === "canceled" ? s : "none";
    return success({
      status,
      ...(shell && status !== "none" && shell.planKey ? { planKey: shell.planKey, cadence: shell.cadence ?? undefined } : {}),
      emailVerified: user.emailVerified,
    });
  });
}

/**
 * SPEC-062 (D-062-20) — cancelar a assinatura da casca (usuário sem organização). Owner da casca; mesmas regras da 053
 * (sem reembolso, `cancelAtPeriodEnd`, provedor primeiro) pelo MESMO miolo `cancelSubscriptionForOrg`.
 */
export async function cancelPendingSubscription(): Promise<ActionResult<SubscriptionChangeResult>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser();
    const shell = await findUserShell(prisma, user.id);
    if (!shell) return formError("Nenhuma assinatura encontrada para cancelar.");
    return cancelSubscriptionForOrg(shell.orgId);
  });
}

/**
 * SPEC-062 (D-062-13) — onde a organização "nasce": só nomeia e FINALIZA a casca paga. Exige casca com assinatura `active`
 * (relida do banco, sob lock). Transação com `lockUser`+`lockOrg`: define `name`/`slug`, `setupPendingSince = null`, recalcula
 * `Organization.status` pelo `computeOrgStatus`, `User.lastOrgId`, `OrgAuditLog org_created`; reemite a sessão na nova org.
 * Idempotente: sem casca pendente e usuário já com org => `/dashboard` sem erro e sem 2ª org. Sem pagamento => `code: no_paid_plan`.
 */
export async function completeOrganizationSetup(input: unknown): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser();
    const parsed = completeOrgSetupSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name } = parsed.data;

    type Outcome = { kind: "done"; orgId: string } | { kind: "already"; orgId: string } | { kind: "no_paid_plan" } | { kind: "slug_conflict" };
    let outcome: Outcome = { kind: "slug_conflict" };
    for (let attempt = 0; attempt < 3 && outcome.kind === "slug_conflict"; attempt++) {
      const slug = await uniqueOrgSlug(name, attempt);
      try {
        outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
          await lockUser(tx, user.id);
          const shell = await findUserShell(tx, user.id);
          if (!shell) {
            // Segundo submit/outra aba: a casca ja foi finalizada. Devolve a org do usuario (sem criar outra).
            const mine = await tx.membership.findFirst({ where: { userId: user.id, org: { setupPendingSince: null } }, orderBy: { createdAt: "desc" }, select: { orgId: true } });
            return mine ? { kind: "already", orgId: mine.orgId } : { kind: "no_paid_plan" };
          }
          await lockOrg(tx, shell.orgId);
          const sub = await tx.subscription.findUnique({ where: { orgId: shell.orgId }, select: { status: true, pastDueSince: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, trialEndsAt: true } });
          if (!sub || sub.status !== "active") return { kind: "no_paid_plan" };
          const now = new Date();
          await tx.organization.update({
            where: { id: shell.orgId },
            data: { name, slug, setupPendingSince: null, status: computeOrgStatus(sub, now), suspendedReason: null },
          });
          await tx.user.update({ where: { id: user.id }, data: { lastOrgId: shell.orgId } });
          await recordOrgAudit(tx, { orgId: shell.orgId, actorUserId: user.id, action: "org_created", meta: { via: "billing_shell" } });
          return { kind: "done", orgId: shell.orgId };
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // colisão de slug: tenta de novo
      }
    }
    if (outcome.kind === "no_paid_plan") {
      return { ok: false, errors: { _form: ["Você ainda não tem um plano pago. Escolha um plano para criar a organização."], code: ["no_paid_plan"] } };
    }
    if (outcome.kind === "slug_conflict") return formError("Não foi possível criar a organização. Tente novamente.");
    await createSession(user.id, outcome.orgId, "provider");
    return success({ orgId: outcome.orgId, redirectTo: "/dashboard" });
  });
}
