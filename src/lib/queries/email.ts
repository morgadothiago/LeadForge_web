import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";

export interface EmailAccountView {
  id: string;
  provider: string;
  smtpHost: string;
  imapHost: string | null;
  port: number;
  email: string;
  fromName: string | null;
  dailyLimit: number;
  isActive: boolean;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  hasPassword: boolean;
  createdAt: Date;
}

const select = {
  id: true, provider: true, smtpHost: true, imapHost: true, port: true, email: true, fromName: true, dailyLimit: true,
  isActive: true, lastVerifiedAt: true, lastError: true, createdAt: true, encryptedPassword: true,
} as const;

function view(a: { encryptedPassword: string } & Omit<EmailAccountView, "hasPassword">): EmailAccountView {
  const { encryptedPassword, ...rest } = a;
  return { ...rest, hasPassword: encryptedPassword.length > 0 };
}

export async function listEmailAccounts(): Promise<EmailAccountView[]> {
  const user = await requireUser();
  return (await prisma.emailAccount.findMany({ where: { userId: user.id }, select, orderBy: { createdAt: "asc" } })).map(view);
}

export async function getEmailAccount(id: string): Promise<EmailAccountView | null> {
  const user = await requireUser();
  const a = await prisma.emailAccount.findFirst({ where: { id, userId: user.id }, select });
  return a ? view(a) : null;
}
