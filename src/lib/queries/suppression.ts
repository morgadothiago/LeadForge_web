import { Prisma, type SuppressionKind, type SuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { findSuppression } from "@/lib/domain/suppression";
import { contactSchema, suppressionListParamsSchema, type SuppressionListParams } from "@/lib/schemas/suppression";

export interface SuppressionItem {
  id: string;
  kind: SuppressionKind;
  value: string;
  reason: SuppressionReason;
  leadId: string | null;
  note: string | null;
  createdAt: Date;
}
export interface SuppressionListResult {
  items: SuppressionItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function listSuppressions(params: SuppressionListParams = {}): Promise<SuppressionListResult> {
  await requireUser();
  const p = suppressionListParamsSchema.parse(params);
  const where: Prisma.SuppressionWhereInput = {
    ...(p.kind ? { kind: p.kind } : {}),
    ...(p.q ? { value: { contains: p.q, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.suppression.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
    prisma.suppression.count({ where }),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize, pageCount: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** `suppressed` + motivo (null se livre). Aceita e-mail e/ou telefone (qualquer formato BR). */
export async function isContactSuppressed(contact: { email?: string | null; phone?: string | null }): Promise<{ suppressed: boolean; reason: SuppressionReason | null }> {
  await requireUser();
  const c = contactSchema.parse(contact);
  const reason = await findSuppression(c);
  return { suppressed: reason !== null, reason };
}
