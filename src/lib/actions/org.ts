"use server";

import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProviderOrgAllowExpired, requireProviderUser } from "@/lib/auth/require-admin";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getClientIpKey } from "@/lib/auth/client-ip";
import { NOT_SHELL } from "@/lib/billing/shell";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { orgInviteTemplate } from "@/lib/channels/email/templates/org-invite";
import { safeErrorForLog } from "@/lib/errors";
import { recordOrgAudit } from "@/lib/org/audit";
import { notifyOrgMemberEvent } from "@/lib/org/notify";
import { actorIsOwner, lockOrg, requireOrgMember, revokeOwnerArtifacts, requireOrgOwner } from "@/lib/org/guards";
import { AlreadyMemberError, JoinInvalidError, joinWithCode, joinWithInvite } from "@/lib/org/join";
import {
  inviteByActorLimiter,
  inviteByTargetLimiter,
  joinByIpLimiter,
  joinByUserLimiter,
  signupJoinLimiter,
} from "@/lib/org/rate-limit";
import {
  formatJoinCode,
  hashInviteToken,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  JOIN_CODE_DEFAULT_DAYS,
  JOIN_CODE_DEFAULT_USES,
  newInviteToken,
  newJoinCode,
  normalizeJoinCode,
} from "@/lib/org/tokens";
import {
  acceptInviteSchema,
  changeMemberRoleSchema,
  generateJoinCodeSchema,
  inviteMemberSchema,
  joinByCodeSchema,
  removeMemberSchema,
  revokeInviteSchema,
  signupJoinSchema,
  switchOrganizationSchema,
} from "@/lib/schemas/org";
import { sendSignupEmails } from "@/lib/auth/email-verification";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-049a — multi-tenant N:N. A org ativa mora no JWT (`orgId`); `switchActiveOrganization` valida a
 * `Membership` e REEMITE o JWT. Papéis (D-049-1): `owner` convida/remove/altera papéis/gere billing; `member`
 * só enxerga a equipe e pode sair. Toda mutação sobre membros usa a org da SESSÃO (nunca um `orgId` do input) e
 * lock de linha na `Organization` para garantir "nunca sem owner" sob concorrência.
 */

const baseUrl = (): string => (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

const INVITE_INVALID = "Convite inválido, expirado ou não destinado a este e-mail.";
const CODE_INVALID = "Código inválido ou expirado.";
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
const LAST_OWNER = "A organização precisa ter ao menos um owner. Promova outro membro a owner antes.";
const FORBIDDEN = "Sem permissão para esta ação.";
const ALREADY_MEMBER = "Você já participa desta organização.";

type OrgRoleName = "owner" | "member";

/** SPEC-056: pos-commit, avisa os owners que `userId` entrou (busca a Membership p/ dedupe). Best-effort, nunca lanca. */
async function notifyJoined(orgId: string, userId: string, orgRole: OrgRoleName): Promise<void> {
  try {
    const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { id: true } });
    if (m) await notifyOrgMemberEvent({ kind: "joined", orgId, memberUserId: userId, membershipId: m.id, orgRole });
  } catch (e) {
    console.error("[org-notify] falha ao preparar aviso de entrada:", safeErrorForLog(e));
  }
}

async function clientIp(): Promise<string> {
  return getClientIpKey(await headers());
}

/** Rate limit de entrada (convite/código): por usuário E por IP. Retorna true se bloqueado. */
async function joinLimited(userKey: string): Promise<boolean> {
  const ip = await clientIp();
  const a = await joinByUserLimiter.hit(userKey);
  const b = await joinByIpLimiter.hit(`ip:${ip}`);
  return a > 0 || b > 0;
}

export interface MyOrganization {
  orgId: string;
  name: string;
  slug: string;
  status: string;
  orgRole: OrgRoleName;
  isActive: boolean;
}

/** Lista as organizações do usuário (para o seletor). Qualquer papel. */
export async function listMyOrganizations(): Promise<ActionResult<{ organizations: MyOrganization[]; activeOrgId: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrgAllowExpired(); // SPEC-065 (D-065-13.2): allowlist (o usuario precisa trocar para outra org)
    // SPEC-062 (D-062-5): a casca de cobranca NUNCA aparece na lista/seletor.
    const rows = await prisma.membership.findMany({
      where: { userId: user.id, org: NOT_SHELL },
      orderBy: { createdAt: "asc" },
      select: { orgRole: true, org: { select: { id: true, name: true, slug: true, status: true } } },
    });
    return success({
      activeOrgId: orgId,
      organizations: rows.map((m) => ({ orgId: m.org.id, name: m.org.name, slug: m.org.slug, status: m.org.status, orgRole: m.orgRole, isActive: m.org.id === orgId })),
    });
  });
}

/** Troca a org ativa: valida a Membership do usuário no destino e reemite o JWT. Org suspensa não impede a troca. */
export async function switchActiveOrganization(input: unknown): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const { user } = await requireProviderOrgAllowExpired(); // SPEC-065 (D-065-13.2): allowlist (o usuario precisa trocar para outra org)
    const parsed = switchOrganizationSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const m = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId: parsed.data.orgId } },
      select: { orgId: true, org: { select: { status: true, setupPendingSince: true } } },
    });
    // Mesma resposta para "não existe" e "não sou membro" (não confirma a existência de orgs alheias). SPEC-062: casca nunca vira org ativa.
    if (!m || m.org.status === "cancelled" || m.org.setupPendingSince) return formError("Organização não encontrada.");
    await prisma.user.update({ where: { id: user.id }, data: { lastOrgId: m.orgId } });
    await createSession(user.id, m.orgId, "provider");
    return success({ orgId: m.orgId, redirectTo: "/dashboard" });
  });
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  orgRole: OrgRoleName;
  joinedAt: Date;
  isSelf: boolean;
}
export interface InviteRow {
  id: string;
  email: string;
  orgRole: OrgRoleName;
  expiresAt: Date;
  createdAt: Date;
}
export interface JoinCodeInfo {
  code: string;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  expired: boolean;
  exhausted: boolean;
}

/** Equipe da org ativa. `invites`/`joinCode` só para owner (member recebe `[]`/`null`). */
export interface TeamView {
  orgRole: OrgRoleName;
  members: MemberRow[];
  invites: InviteRow[];
  joinCode: JoinCodeInfo | null;
}
export async function listMembers(): Promise<ActionResult<TeamView>> {
  return safeAction<TeamView>(async () => {
    const { user, orgId, orgRole } = await requireOrgMember();
    const rows = await prisma.membership.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: { userId: true, orgRole: true, createdAt: true, user: { select: { name: true, email: true } } },
    });
    const members = rows.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, orgRole: m.orgRole, joinedAt: m.createdAt, isSelf: m.userId === user.id }));
    if (orgRole !== "owner") return success({ orgRole, members, invites: [], joinCode: null });
    const now = new Date();
    const invites = await prisma.orgInvite.findMany({
      where: { orgId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, orgRole: true, expiresAt: true, createdAt: true },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { joinCode: true, joinCodeExpiresAt: true, joinCodeMaxUses: true, joinCodeUses: true },
    });
    const joinCode: JoinCodeInfo | null = org.joinCode
      ? {
          code: formatJoinCode(org.joinCode),
          expiresAt: org.joinCodeExpiresAt,
          maxUses: org.joinCodeMaxUses,
          uses: org.joinCodeUses,
          expired: !org.joinCodeExpiresAt || org.joinCodeExpiresAt <= now,
          exhausted: org.joinCodeMaxUses === null || org.joinCodeUses >= org.joinCodeMaxUses,
        }
      : null;
    return success({ orgRole, members, invites, joinCode });
  });
}

/** Convite nominal por e-mail (owner). Token só no link do e-mail; banco guarda o hash. */
export async function inviteMember(input: unknown): Promise<ActionResult<{ inviteId: string; emailSent: boolean }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    const parsed = inviteMemberSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { email, orgRole } = parsed.data;
    if (await inviteByActorLimiter.hit(`${orgId}:${user.id}`) > 0 || await inviteByTargetLimiter.hit(`${orgId}:${email}`) > 0) return formError(TOO_MANY);

    const already = await prisma.membership.findFirst({ where: { orgId, user: { email } }, select: { id: true } });
    if (already) return failure({ email: ["Este e-mail já participa da organização."] });

    const { token, hash } = newInviteToken();
    const now = new Date();
    const invite = await prisma.$transaction(async (tx) => {
      // Convite novo substitui os pendentes do mesmo e-mail (só 1 link válido por e-mail/org).
      await tx.orgInvite.updateMany({ where: { orgId, email, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      const created = await tx.orgInvite.create({
        data: { orgId, email, orgRole, tokenHash: hash, expiresAt: new Date(now.getTime() + INVITE_TTL_MS), createdByUserId: user.id },
        select: { id: true },
      });
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "member_invited", meta: { inviteId: created.id, email, orgRole } });
      return created;
    });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
    const { subject, html, text } = orgInviteTemplate({ link: `${baseUrl()}/convite/${token}`, orgName: org.name, inviterName: user.name, expiresInDays: INVITE_TTL_DAYS });
    const sent = await sendSystemEmail(email, subject, { html, text }, "org_invite");
    if (!sent.ok) console.error("[inviteMember] falha ao enviar e-mail:", safeErrorForLog(sent.error));
    return success({ inviteId: invite.id, emailSent: sent.ok });
  });
}

/** Revoga convite pendente da org ativa (id de outra org => "não encontrado"). */
export async function revokeInvite(input: unknown): Promise<ActionResult<{ revoked: true }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    const parsed = revokeInviteSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await prisma.$transaction(async (tx) => {
      const res = await tx.orgInvite.updateMany({ where: { id: parsed.data.inviteId, orgId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count > 0) await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "invite_revoked", meta: { inviteId: parsed.data.inviteId } });
      return res.count;
    });
    if (r === 0) return formError("Convite não encontrado ou já utilizado.");
    return success({ revoked: true as const });
  });
}

/** Aceita convite nominal (usuário logado; e-mail da conta = e-mail do convite, case-insensitive). Torna a org ativa. */
export async function acceptInvite(input: unknown): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser(); // SPEC-062 (D-062-15): funciona com sessao SEM org (entra sem checkout)
    if (await joinLimited(`user:${user.id}`)) return formError(TOO_MANY);
    const parsed = acceptInviteSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    try {
      const joined = await prisma.$transaction((tx) =>
        joinWithInvite(tx, { tokenHash: hashInviteToken(parsed.data.token), userId: user.id, userEmail: user.email, now: new Date(), via: "invite" }),
      );
      await notifyJoined(joined.orgId, user.id, joined.orgRole);
      await createSession(user.id, joined.orgId, "provider");
      return success({ orgId: joined.orgId, redirectTo: "/dashboard" });
    } catch (e) {
      if (e instanceof JoinInvalidError) return formError(INVITE_INVALID);
      if (e instanceof AlreadyMemberError) return formError(ALREADY_MEMBER);
      throw e;
    }
  });
}

/** Entra numa org por código reutilizável (cria Membership `member`, sem aprovação — D-049-2). Torna a org ativa. */
export async function joinByCode(input: unknown): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const { user } = await requireProviderUser(); // SPEC-062 (D-062-15): funciona com sessao SEM org (entra sem checkout)
    if (await joinLimited(`user:${user.id}`)) return formError(TOO_MANY);
    const parsed = joinByCodeSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    try {
      const joined = await prisma.$transaction((tx) => joinWithCode(tx, { code: normalizeJoinCode(parsed.data.code), userId: user.id, now: new Date(), via: "code" }));
      await notifyJoined(joined.orgId, user.id, joined.orgRole);
      await createSession(user.id, joined.orgId, "provider");
      return success({ orgId: joined.orgId, redirectTo: "/dashboard" });
    } catch (e) {
      if (e instanceof JoinInvalidError) return formError(CODE_INVALID);
      if (e instanceof AlreadyMemberError) return formError(ALREADY_MEMBER);
      throw e;
    }
  });
}

/** Gera (ou rotaciona) o código reutilizável da org ativa. Expiração e limite de usos sempre definidos. */
export async function generateJoinCode(input: unknown = {}): Promise<ActionResult<{ code: string; expiresAt: Date; maxUses: number }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    const parsed = generateJoinCodeSchema.safeParse(input ?? {});
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const days = parsed.data.expiresInDays ?? JOIN_CODE_DEFAULT_DAYS;
    const maxUses = parsed.data.maxUses ?? JOIN_CODE_DEFAULT_USES;
    const expiresAt = new Date(Date.now() + days * 24 * 3600_000);
    const code = newJoinCode();
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: orgId }, data: { joinCode: code, joinCodeExpiresAt: expiresAt, joinCodeMaxUses: maxUses, joinCodeUses: 0 } });
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "join_code_generated", meta: { expiresInDays: days, maxUses } });
    });
    return success({ code: formatJoinCode(code), expiresAt, maxUses });
  });
}

/** Desativa o código reutilizável da org ativa. */
export async function disableJoinCode(): Promise<ActionResult<{ disabled: true }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: orgId }, data: { joinCode: null, joinCodeExpiresAt: null, joinCodeMaxUses: null, joinCodeUses: 0 } });
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "join_code_disabled" });
    });
    return success({ disabled: true as const });
  });
}

/** Altera o papel de um membro da org ativa (owner). Bloqueia rebaixar o último owner. */
export async function changeMemberRole(input: unknown): Promise<ActionResult<{ userId: string; orgRole: OrgRoleName }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    const parsed = changeMemberRoleSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { userId, orgRole } = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      await lockOrg(tx, orgId);
      if (!(await actorIsOwner(tx, orgId, user.id))) return "forbidden" as const; // papel relido SOB o lock (D-049-12)
      const target = await tx.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { id: true, orgRole: true } });
      if (!target) return "not_found" as const;
      if (target.orgRole === orgRole) return "ok" as const;
      if (target.orgRole === "owner" && orgRole === "member") {
        const owners = await tx.membership.count({ where: { orgId, orgRole: "owner" } });
        if (owners <= 1) return "last_owner" as const;
      }
      await tx.membership.update({ where: { id: target.id }, data: { orgRole } });
      if (target.orgRole === "owner" && orgRole === "member") await revokeOwnerArtifacts(tx, orgId, userId);
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "role_changed", targetUserId: userId, meta: { from: target.orgRole, to: orgRole } });
      return { changed: { membershipId: target.id, from: target.orgRole } } as const;
    });
    if (result === "forbidden") return formError(FORBIDDEN);
    if (result === "not_found") return formError("Membro não encontrado.");
    if (result === "last_owner") return formError(LAST_OWNER);
    if (typeof result === "object") await notifyOrgMemberEvent({ kind: "role_changed", orgId, memberUserId: userId, actorUserId: user.id, membershipId: result.changed.membershipId, orgRole, fromRole: result.changed.from });
    return success({ userId, orgRole });
  });
}

/** Remove um membro da org ativa (owner). Para sair, use `leaveOrganization`. A sessão do removido deixa de valer na org (requireUser). */
export async function removeMember(input: unknown): Promise<ActionResult<{ removed: true }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgOwner();
    const parsed = removeMemberSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { userId } = parsed.data;
    if (userId === user.id) return formError("Para sair da organização use a opção \"Sair\".");
    const result = await prisma.$transaction(async (tx) => {
      await lockOrg(tx, orgId);
      if (!(await actorIsOwner(tx, orgId, user.id))) return "forbidden" as const; // papel relido SOB o lock (D-049-12)
      const target = await tx.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { id: true, orgRole: true } });
      if (!target) return "not_found" as const;
      if (target.orgRole === "owner" && (await tx.membership.count({ where: { orgId, orgRole: "owner" } })) <= 1) return "last_owner" as const;
      await revokeOwnerArtifacts(tx, orgId, userId);
      await tx.membership.delete({ where: { id: target.id } });
      await tx.user.updateMany({ where: { id: userId, lastOrgId: orgId }, data: { lastOrgId: null } });
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "member_removed", targetUserId: userId, meta: { orgRole: target.orgRole } });
      return { removedMembershipId: target.id } as const;
    });
    if (result === "forbidden") return formError(FORBIDDEN);
    if (result === "last_owner") return formError(LAST_OWNER);
    if (result === "not_found") return formError("Membro não encontrado.");
    await notifyOrgMemberEvent({ kind: "removed", orgId, memberUserId: userId, actorUserId: user.id, membershipId: result.removedMembershipId });
    return success({ removed: true as const });
  });
}

/** Sai da org ativa. Bloqueia: último owner; única organização do usuário (ficaria sem org para entrar). Reemite o JWT em outra org. */
export async function leaveOrganization(): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireOrgMember({ allowExpired: true });
    const result = await prisma.$transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const mine = await tx.membership.findMany({ where: { userId: user.id, org: NOT_SHELL }, orderBy: { createdAt: "asc" }, select: { id: true, orgId: true, orgRole: true } });
      const current = mine.find((m) => m.orgId === orgId);
      if (!current) return { ok: false as const, error: "Organização não encontrada." } as const;
      if (mine.length <= 1) return { ok: false as const, error: "Esta é a sua única organização. Crie ou entre em outra antes de sair." } as const;
      if (current.orgRole === "owner") {
        const owners = await tx.membership.count({ where: { orgId, orgRole: "owner" } });
        if (owners <= 1) return { ok: false as const, error: LAST_OWNER } as const;
      }
      if (current.orgRole === "owner") await revokeOwnerArtifacts(tx, orgId, user.id);
      await tx.membership.delete({ where: { id: current.id } });
      const next = mine.find((m) => m.orgId !== orgId)!;
      await tx.user.update({ where: { id: user.id }, data: { lastOrgId: next.orgId } });
      await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "member_left", targetUserId: user.id });
      return { ok: true as const, nextOrgId: next.orgId, membershipId: current.id };
    });
    if (!result.ok) return formError(result.error);
    await notifyOrgMemberEvent({ kind: "left", orgId, memberUserId: user.id, actorUserId: user.id, membershipId: result.membershipId });
    await createSession(user.id, result.nextOrgId, "provider");
    return success({ orgId: result.nextOrgId, redirectTo: "/dashboard" });
  });
}

/**
 * Pré-visualização PÚBLICA do convite (página `/convite/[token]`): só quem tem o token vê o nome da org e o e-mail
 * convidado. Inválido/expirado/usado/revogado => `valid:false` sem detalhe. Rate limit por IP.
 */
export async function previewInvite(input: unknown): Promise<ActionResult<{ valid: false } | { valid: true; orgName: string; email: string; orgRole: OrgRoleName; userExists: boolean }>> {
  return safeAction(async () => {
    if (await joinByIpLimiter.hit(`ip:${await clientIp()}`) > 0) return formError(TOO_MANY);
    const parsed = acceptInviteSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const inv = await prisma.orgInvite.findUnique({
      where: { tokenHash: hashInviteToken(parsed.data.token) },
      select: { email: true, orgRole: true, usedAt: true, revokedAt: true, expiresAt: true, org: { select: { name: true, status: true, setupPendingSince: true } } },
    });
    if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= new Date() || inv.org.status === "cancelled" || inv.org.setupPendingSince) return success({ valid: false as const });
    const exists = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    return success({ valid: true as const, orgName: inv.org.name, email: inv.email, orgRole: inv.orgRole, userExists: Boolean(exists) });
  });
}

/**
 * Signup por CONVITE (link `/convite/[token]`; sem checkout — a assinatura é da org). Ação PÚBLICA. O e-mail da conta é o do
 * convite (posse do token => verificado, D-055-6). SPEC-062 (D-062-15): o ramo por CÓDIGO saiu (o código é digitado logado,
 * em `joinByCode`). Cria User + Membership atomicamente e abre a sessão na org.
 */
export async function signUpAndJoin(input: unknown): Promise<ActionResult<{ orgId: string; redirectTo: string }>> {
  return safeAction(async () => {
    const ip = await clientIp();
    if (await signupJoinLimiter.hit(`ip:${ip}`) > 0) return formError(TOO_MANY);
    const parsed = signupJoinSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { name, password, token } = parsed.data;
    const GENERIC_SIGNUP = "Não foi possível concluir o cadastro com os dados informados. Verifique as informações e tente novamente, ou entre em contato com o suporte.";

    const tokenHash = hashInviteToken(token);
    const inv = await prisma.orgInvite.findUnique({ where: { tokenHash }, select: { email: true, usedAt: true, revokedAt: true, expiresAt: true } });
    if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= new Date()) return formError(INVITE_INVALID);
    const email = inv.email;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return formError("Este e-mail já possui cadastro. Entre na sua conta e aceite o convite.");

    const passwordHash = await hashPassword(password);
    const now = new Date();
    try {
      const joined = await prisma.$transaction(async (tx) => {
        // SPEC-055 (D-055-6): convite valido para ESTE e-mail (posse da caixa provada pelo token) => verificado.
        const created = await tx.user.create({ data: { name, email, role: "provider", passwordHash, emailVerifiedAt: now }, select: { id: true } });
        const j = await joinWithInvite(tx, { tokenHash, userId: created.id, userEmail: email, now, via: "signup_invite" });
        return { ...j, userId: created.id };
      });
      // SPEC-055: boas-vindas pos-commit (idempotente, best-effort); o convite ja provou o e-mail (sem verificacao). O novo membro ja tem org: copy "app", sem "escolha seu plano".
      await sendSignupEmails({ id: joined.userId, name, email }, { verify: false, hasOrg: true });
      await notifyJoined(joined.orgId, joined.userId, joined.orgRole);
      await createSession(joined.userId, joined.orgId, "provider");
      return success({ orgId: joined.orgId, redirectTo: "/dashboard" });
    } catch (e) {
      if (e instanceof JoinInvalidError) return formError(INVITE_INVALID);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return formError(GENERIC_SIGNUP);
      throw e;
    }
  });
}
