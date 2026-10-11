import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { sendSystemEmail, type EmailScenario } from "@/lib/channels/system-mail";

/**
 * SPEC-052a — infra generica de idempotencia de e-mails transacionais (reusada pelas SPECs 053-056).
 * `EmailDispatchLog.dedupeKey` (unique) e INSERIDA ANTES do envio (mesmo padrao de `BillingReminderLog`):
 * P2002 = ja reservado/enviado -> nao reenvia. Prioriza "nunca duplica" sobre "nunca perde": falha
 * ocasional de provider depois da reserva nao e retentada. Best-effort: NUNCA lanca.
 */
export type SendOnceResult = "sent" | "duplicate" | "failed";

export interface SendOnceInput {
  dedupeKey: string;
  scenario: EmailScenario;
  to: string;
  subject: string;
  html: string;
  text: string;
  orgId?: string | null;
  userId?: string | null;
}

export async function sendOnce(input: SendOnceInput): Promise<SendOnceResult> {
  try {
    await prisma.emailDispatchLog.create({
      data: { scenario: input.scenario, dedupeKey: input.dedupeKey, orgId: input.orgId ?? null, userId: input.userId ?? null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    console.error(`[send-once] falha ao reservar chave (${input.scenario}):`, safeErrorForLog(e));
    return "failed";
  }
  try {
    const r = await sendSystemEmail(input.to, input.subject, { html: input.html, text: input.text }, input.scenario);
    if (!r.ok) {
      console.error(`[send-once] falha ao enviar e-mail (${input.scenario}):`, safeErrorForLog(r.error));
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error(`[send-once] envio lançou (${input.scenario}):`, safeErrorForLog(e));
    return "failed";
  }
}

export interface NotifyOrgOwnersInput {
  orgId: string;
  scenario: EmailScenario;
  subject: string;
  html: string;
  text: string;
  /**
   * Idempotencia: chave-base; cada owner recebe `${dedupeKey}:${userId}` (um owner nao bloqueia o outro).
   * Ausente = envio direto sem log (chamadores que ja tem idempotencia propria, ex.: `BillingReminderLog`).
   */
  dedupeKey?: string;
  /** SPEC-056: owners a NAO notificar (ex.: o ator do proprio ato). */
  excludeUserIds?: string[];
}

/**
 * Unico helper de notificacao dos owners da org (substitui as copias de `process-event.ts` e `reminders.ts`;
 * SPEC-046 D-046-3). Best-effort: nunca lanca (nem se a consulta de owners falhar).
 */
export async function notifyOrgOwners(input: NotifyOrgOwnersInput): Promise<void> {
  try {
    const owners = await prisma.membership.findMany({ where: { orgId: input.orgId, orgRole: "owner", ...(input.excludeUserIds?.length ? { userId: { notIn: input.excludeUserIds } } : {}) }, select: { userId: true, user: { select: { email: true } } } });
    for (const m of owners) {
      if (input.dedupeKey) {
        await sendOnce({ ...input, dedupeKey: `${input.dedupeKey}:${m.userId}`, to: m.user.email, userId: m.userId });
        continue;
      }
      try {
        const r = await sendSystemEmail(m.user.email, input.subject, { html: input.html, text: input.text }, input.scenario);
        if (!r.ok) console.error(`[notify-owners] falha ao enviar e-mail (org ${input.orgId}, ${input.scenario}):`, safeErrorForLog(r.error));
      } catch (e) {
        console.error(`[notify-owners] envio lançou (org ${input.orgId}, ${input.scenario}):`, safeErrorForLog(e));
      }
    }
  } catch (e) {
    console.error(`[notify-owners] falha ao notificar owners (org ${input.orgId}, ${input.scenario}):`, safeErrorForLog(e));
  }
}

/** Link ABSOLUTO a partir de `APP_BASE_URL` (fallback `AUTH_URL`, depois localhost), como nas actions. */
export function absoluteAppUrl(path: string): string {
  const base = (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
