import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { absoluteAppUrl, notifyOrgOwners } from "@/lib/channels/email/send-once";
import { orgMemberEventTemplate, type OrgMemberEventKind } from "@/lib/channels/email/templates/org-member-event";
import type { EmailScenario } from "@/lib/channels/system-mail";

/**
 * SPEC-056 — e-mail aos OWNERS da org sobre eventos de equipe. SEMPRE chamado DEPOIS do commit (nunca dentro de
 * transacao/lockOrg). Best-effort: nunca lanca. O ator e excluido (D-056-3); membro afetado nao recebe (D-056-1).
 */
export const ORG_JOIN_EMAILS_PER_HOUR = 10; // D-056-2: teto por org/hora para entradas

const SCENARIO: Record<OrgMemberEventKind, EmailScenario> = {
  joined: "org_member_joined",
  left: "org_member_left",
  removed: "org_member_removed",
  role_changed: "org_role_changed",
};

export interface NotifyOrgMemberEventInput {
  kind: OrgMemberEventKind;
  orgId: string;
  /** Usuario afetado (entrou/saiu/removido/papel alterado). */
  memberUserId: string;
  /** Quem praticou o ato (nao e notificado). Null = nao ha owner-ator (ex.: entrada por codigo). */
  actorUserId?: string | null;
  /** Id da Membership (para dedupe). */
  membershipId: string;
  orgRole?: "owner" | "member";
  fromRole?: "owner" | "member";
}

export async function notifyOrgMemberEvent(i: NotifyOrgMemberEventInput): Promise<void> {
  try {
    const now = new Date();
    if (i.kind === "joined") {
      // O audit `member_joined` ja foi gravado na transacao (inclui esta entrada): acima do teto, so fica na auditoria.
      const n = await prisma.orgAuditLog.count({ where: { orgId: i.orgId, action: "member_joined", createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
      if (n > ORG_JOIN_EMAILS_PER_HOUR) return;
    }
    const [org, member] = await Promise.all([
      prisma.organization.findUnique({ where: { id: i.orgId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: i.memberUserId }, select: { name: true, email: true } }),
    ]);
    if (!org || !member) return;
    const { subject, html, text } = orgMemberEventTemplate({
      kind: i.kind,
      orgName: org.name,
      memberName: member.name,
      memberEmail: member.email,
      date: now,
      link: absoluteAppUrl("/configuracoes/equipe"),
      orgRole: i.orgRole,
      fromRole: i.fromRole,
    });
    const scenario = SCENARIO[i.kind];
    // role_changed pode repetir legitimamente (A->B->A): inclui o instante na chave; os demais sao unicos por membership.
    const suffix = i.kind === "role_changed" ? `${i.membershipId}:${now.getTime()}` : i.membershipId;
    await notifyOrgOwners({
      orgId: i.orgId,
      scenario,
      subject,
      html,
      text,
      dedupeKey: `${scenario}:${i.orgId}:${i.memberUserId}:${suffix}`,
      excludeUserIds: [i.actorUserId, i.memberUserId].filter((x): x is string => Boolean(x)),
    });
  } catch (e) {
    console.error(`[org-notify] falha (${i.kind}, org ${i.orgId}):`, safeErrorForLog(e));
  }
}
