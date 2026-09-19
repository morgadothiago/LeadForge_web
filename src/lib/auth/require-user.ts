import { prisma } from "@/lib/prisma";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

/** Email do usuário mock até a SPEC-009 (auth). Único ponto a trocar. */
export const MOCK_USER_EMAIL = "admin@leadforge.local";

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado.");
    this.name = "UnauthorizedError";
  }
}

/** Único helper de autenticação das actions. Mock até a SPEC-009. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({
    where: { email: MOCK_USER_EMAIL },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new UnauthorizedError();
  return user;
}
