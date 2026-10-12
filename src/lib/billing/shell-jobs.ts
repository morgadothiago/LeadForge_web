import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { absoluteAppUrl, notifyOrgOwners } from "@/lib/channels/email/send-once";
import { orgSetupReminderTemplate, type OrgSetupReminderStep } from "@/lib/channels/email/templates/org-setup-reminder";
import { lockOrg } from "@/lib/org/guards";
import { IS_SHELL, SHELL_ABANDON_MS, type Db } from "./shell";

/**
 * SPEC-062 (D-062-18/19) — jobs do tick sobre cascas de cobranca. Isolados (`.catch` no tick); nada aqui lanca para fora.
 */
const DAY_MS = 24 * 3600_000;

export interface PurgeShellsResult {
  purged: number;
  skipped: number;
  errors: number;
}

interface ShellFacts {
  paymentSignal: boolean;
  canceledLongAgo: boolean;
  memberCount: number;
}

/** Sinais de pagamento: assinatura ativa/em atraso, id externo, periodo pago ou QUALQUER `WebhookEvent` da org. */
async function shellFacts(orgId: string, cutoff: Date, db: Db): Promise<ShellFacts | null> {
  const org = await db.organization.findFirst({
    where: { id: orgId, ...IS_SHELL },
    select: { subscription: { select: { status: true, externalSubscriptionId: true, currentPeriodEnd: true, canceledAt: true } }, _count: { select: { memberships: true, webhookEvents: true } } },
  });
  if (!org) return null;
  const sub = org.subscription;
  const paymentSignal =
    !!sub && (sub.status === "active" || sub.status === "past_due" || sub.status === "trialing" || sub.externalSubscriptionId !== null || sub.currentPeriodEnd !== null) || org._count.webhookEvents > 0;
  const canceledLongAgo = !!sub && sub.status === "canceled" && sub.canceledAt !== null && sub.canceledAt.getTime() <= cutoff.getTime();
  return { paymentSignal, canceledLongAgo, memberCount: org._count.memberships };
}

/**
 * D-062-18/20: apaga (hard delete; cascade de `Membership`/`Subscription`) cascas com `setupPendingSince` ha > 7 dias que:
 * (a) NAO tem nenhum sinal de pagamento (sem assinatura ativa, `externalSubscriptionId`, periodo pago nem `WebhookEvent`) — inclui casca sem membros; ou
 * (b) tiveram o cancelamento EFETIVADO (`canceled`) ha > 7 dias (nao ha dado a reter; D-062-20).
 * NUNCA apaga casca paga (`active`/`past_due`) nem com sinal de pagamento sem cancelamento efetivado. Cada exclusao revalida sob `lockOrg`.
 */
export async function purgeAbandonedShells(now: Date): Promise<PurgeShellsResult> {
  const result: PurgeShellsResult = { purged: 0, skipped: 0, errors: 0 };
  const cutoff = new Date(now.getTime() - SHELL_ABANDON_MS);
  const candidates = await prisma.organization.findMany({ where: { setupPendingSince: { not: null, lte: cutoff } }, select: { id: true } });
  for (const { id } of candidates) {
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        await lockOrg(tx, id);
        const f = await shellFacts(id, cutoff, tx);
        if (!f) return false;
        if (f.paymentSignal && !f.canceledLongAgo) return false;
        await tx.organization.delete({ where: { id } });
        return true;
      });
      if (deleted) result.purged++;
      else result.skipped++;
    } catch (e) {
      result.errors++;
      console.error(`[shell-purge] falha ao apagar casca ${id}:`, safeErrorForLog(e));
    }
  }
  return result;
}

const STEPS: Array<{ step: OrgSetupReminderStep; days: number }> = [
  { step: "d1", days: 1 },
  { step: "d3", days: 3 },
  { step: "d7", days: 7 },
];
const REMINDER_LAST_MS = 8 * DAY_MS; // "so ate D+7": passada a janela do D+7 nao envia mais nada

export interface ShellReminderResult {
  considered: number;
  errors: number;
}

/**
 * D-062-19: lembretes D+1/D+3/D+7 para casca PAGA sem organizacao (noreply, `sendOnce` via `notifyOrgOwners`, chave
 * `org_setup_reminder:<orgId>:<d1|d3|d7>`:<userId>). Ancora = primeiro evento de billing da org (quando pagou); sem evento, `setupPendingSince`.
 * So o passo mais recente devido e enviado (tick parado nao dispara 3 e-mails juntos). Para sozinho ao finalizar (filtro `setupPendingSince`).
 */
export async function sendOrgSetupReminders(now: Date): Promise<ShellReminderResult> {
  const result: ShellReminderResult = { considered: 0, errors: 0 };
  const shells = await prisma.organization.findMany({
    where: { ...IS_SHELL, subscription: { status: "active" } },
    select: { id: true, setupPendingSince: true, subscription: { select: { plan: { select: { name: true } } } } },
  });
  for (const shell of shells) {
    try {
      const first = await prisma.webhookEvent.findFirst({ where: { orgId: shell.id, source: "billing" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
      const anchor = first?.createdAt ?? shell.setupPendingSince;
      if (!anchor) continue;
      const elapsed = now.getTime() - anchor.getTime();
      if (elapsed >= REMINDER_LAST_MS) continue;
      const due = STEPS.filter((s) => elapsed >= s.days * DAY_MS);
      const latest = due[due.length - 1];
      if (!latest) continue;
      result.considered++;
      const { subject, html, text } = orgSetupReminderTemplate({ step: latest.step, planName: shell.subscription?.plan.name ?? "contratado", link: absoluteAppUrl("/organizacao/nova") });
      await notifyOrgOwners({ orgId: shell.id, scenario: "org_setup_reminder", subject, html, text, dedupeKey: `org_setup_reminder:${shell.id}:${latest.step}` });
    } catch (e) {
      result.errors++;
      console.error(`[shell-reminder] falha ao processar casca ${shell.id}:`, safeErrorForLog(e));
    }
  }
  return result;
}
