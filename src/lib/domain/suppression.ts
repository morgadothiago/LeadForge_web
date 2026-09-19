import type { Prisma, PrismaClient, SuppressionKind, SuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeBrPhone } from "./phone";

/** Lista de supressão global (SPEC-017): consultada antes de QUALQUER envio, em todos os canais e campanhas. */
type Db = Prisma.TransactionClient | PrismaClient;

export interface ContactRef {
  email?: string | null;
  phone?: string | null;
}
export interface NormalizedContact {
  email: string | null;
  phone: string | null;
}

export const SUPPRESSED_MESSAGE = "suprimido";

/** E-mail: trim + minúsculas. Telefone: E.164 BR via normalizeBrPhone (inválido -> null). */
export function normalizeContact(c: ContactRef): NormalizedContact {
  const email = c.email?.trim().toLowerCase() || null;
  const p = c.phone?.trim() ? normalizeBrPhone(c.phone) : null;
  return { email, phone: p && p.ok ? p.e164 : null };
}

function pairs(c: NormalizedContact): { kind: SuppressionKind; value: string }[] {
  return [
    ...(c.email ? [{ kind: "email" as const, value: c.email }] : []),
    ...(c.phone ? [{ kind: "phone" as const, value: c.phone }] : []),
  ];
}

/** Motivo da supressão se o e-mail OU o telefone estão na lista; null caso contrário. */
export async function findSuppression(contact: ContactRef, db: Db = prisma): Promise<SuppressionReason | null> {
  const where = pairs(normalizeContact(contact));
  if (!where.length) return null;
  const row = await db.suppression.findFirst({ where: { OR: where }, select: { reason: true } });
  return row?.reason ?? null;
}

export async function isSuppressed(contact: ContactRef, db: Db = prisma): Promise<boolean> {
  return (await findSuppression(contact, db)) !== null;
}

/** Idempotente (upsert): já existente = mantém o motivo original. Grava e-mail e/ou telefone. Devolve quantos contatos foram tratados. */
export async function addSuppression(
  tx: Db | undefined,
  input: ContactRef & { reason: SuppressionReason; leadId?: string | null; note?: string | null },
): Promise<number> {
  const db = tx ?? prisma;
  const list = pairs(normalizeContact(input));
  for (const { kind, value } of list) {
    await db.suppression.upsert({
      where: { kind_value: { kind, value } },
      create: { kind, value, reason: input.reason, leadId: input.leadId ?? null, note: input.note ?? null },
      update: {},
    });
  }
  return list.length;
}

/** Remove e-mail e/ou telefone da lista. Devolve quantas linhas saíram. */
export async function removeSuppression(tx: Db | undefined, contact: ContactRef): Promise<number> {
  const db = tx ?? prisma;
  const where = pairs(normalizeContact(contact));
  if (!where.length) return 0;
  return (await db.suppression.deleteMany({ where: { OR: where } })).count;
}

/** Em lote (sem N+1): ids dos itens cujo e-mail ou telefone estão suprimidos. */
export async function suppressedIds(items: { id: string; email?: string | null; phone?: string | null }[], db: Db = prisma): Promise<Set<string>> {
  const norm = items.map((i) => ({ id: i.id, ...normalizeContact(i) }));
  const or = norm.flatMap((n) => pairs(n));
  if (!or.length) return new Set();
  const rows = await db.suppression.findMany({ where: { OR: or }, select: { kind: true, value: true } });
  const keys = new Set(rows.map((r) => `${r.kind}:${r.value}`));
  return new Set(norm.filter((n) => (n.email && keys.has(`email:${n.email}`)) || (n.phone && keys.has(`phone:${n.phone}`))).map((n) => n.id));
}
