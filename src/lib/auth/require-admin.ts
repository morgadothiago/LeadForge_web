import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "./require-user";

export class ForbiddenError extends Error {
  constructor() {
    super("Sem permissão.");
    this.name = "ForbiddenError";
  }
}

/** Exige sessão + papel `admin` (relido do banco a cada chamada; nunca confia no token). Lança UnauthorizedError/ForbiddenError. */
export async function requireAdmin(): Promise<CurrentUser & { role: string }> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!row || row.role !== "admin") throw new ForbiddenError();
  return { ...user, role: row.role };
}
