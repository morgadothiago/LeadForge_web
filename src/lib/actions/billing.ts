"use server";

import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireProviderOrg } from "@/lib/auth/require-admin";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getClientIp } from "@/lib/auth/client-ip";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { getPaymentProvider } from "@/lib/billing/provider-factory";
import { TRIAL_DAYS } from "@/lib/billing/status-map";
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
    const ip = getClientIp(await headers());
    const wait = signupLimiter.hit(ip);
    if (wait > 0) return formError(`Muitas tentativas. Tente novamente em ${wait}s.`);

    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name, email, password, orgName, planKey } = parsed.data;

    const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { id: true, active: true, selfServiceCheckout: true } });
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
        const user = await tx.user.create({ data: { name, email, role: "provider", passwordHash }, select: { id: true } });
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

    await createSession(userId, orgId, "provider");
    return success({ redirectTo: "/dashboard" });
  });
}
