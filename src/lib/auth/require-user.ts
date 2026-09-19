import { prisma } from "@/lib/prisma";
import { getSession } from "./session";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado.");
    this.name = "UnauthorizedError";
  }
}

/** Único helper de autenticação das actions/queries: valida a sessão e relê o usuário no banco. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new UnauthorizedError();
  return user;
}
