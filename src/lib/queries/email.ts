import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";

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
  const { user, orgId } = await requireProviderOrg();
  return (await scopedPrisma(orgId).emailAccount.findMany({ where: { userId: user.id }, select, orderBy: { createdAt: "asc" } })).map(view);
}

export async function getEmailAccount(id: string): Promise<EmailAccountView | null> {
  const { user, orgId } = await requireProviderOrg();
  const a = await scopedPrisma(orgId).emailAccount.findFirst({ where: { id, userId: user.id }, select });
  return a ? view(a) : null;
}
