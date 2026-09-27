"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { encrypt } from "@/lib/crypto/secret-box";
import { buildTransport, sanitizeError } from "@/lib/channels/email";
import { normalizeSmtpError } from "@/lib/channels/smtp-errors";
import {
  emailAccountCreateSchema, emailAccountIdSchema, emailAccountUpdateSchema, setActiveSchema,
} from "@/lib/schemas/email";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const DUP = { email: ["Já existe uma conta cadastrada com este e-mail."] };
const VERIFY_TIMEOUT_MS = 15_000;

function revalidate(): void {
  revalidatePath("/configuracoes/email");
}
const isDup = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createEmailAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = emailAccountCreateSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { password, ...data } = parsed.data;
    try {
      const a = await prisma.emailAccount.create({
        data: { ...data, orgId, userId: user.id, encryptedPassword: encrypt(password) },
        select: { id: true },
      });
      revalidate();
      return success(a);
    } catch (e) {
      if (isDup(e)) return failure(DUP);
      throw e;
    }
  });
}

export async function updateEmailAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = emailAccountUpdateSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, password, ...data } = parsed.data;
    const db = scopedPrisma(orgId);
    if (!(await db.emailAccount.count({ where: { id, userId: user.id } }))) return formError("Conta não encontrada.");
    try {
      await db.emailAccount.update({
        where: { id },
        data: { ...data, imapHost: data.imapHost ?? null, fromName: data.fromName ?? null, ...(password ? { encryptedPassword: encrypt(password) } : {}) },
      });
      revalidate();
      return success({ id });
    } catch (e) {
      if (isDup(e)) return failure(DUP);
      throw e;
    }
  });
}

export async function deleteEmailAccount(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = emailAccountIdSchema.safeParse(id);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await scopedPrisma(orgId).emailAccount.deleteMany({ where: { id: parsed.data, userId: user.id } });
    if (!r.count) return formError("Conta não encontrada.");
    revalidate();
    return success({ id: parsed.data });
  });
}

export async function setActive(input: unknown): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = setActiveSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await scopedPrisma(orgId).emailAccount.updateMany({ where: { id: parsed.data.id, userId: user.id }, data: { isActive: parsed.data.isActive } });
    if (!r.count) return formError("Conta não encontrada.");
    revalidate();
    return success(parsed.data);
  });
}

/** Testa a conexão SMTP (`verify()` com timeout). Resultado PT-BR; grava lastVerifiedAt/lastError sanitizado. */
export async function testEmailConnection(accountId: unknown): Promise<ActionResult<{ ok: boolean; message: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const id = emailAccountIdSchema.safeParse(accountId);
    if (!id.success) return failure(zodErrors(id.error));
    const db = scopedPrisma(orgId);
    const account = await db.emailAccount.findFirst({ where: { id: id.data, userId: user.id } });
    if (!account) return formError("Conta não encontrada.");
    let timer: NodeJS.Timeout | undefined;
    try {
      const transport = await buildTransport(account);
      await Promise.race([
        transport.verify(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), VERIFY_TIMEOUT_MS); }),
      ]);
      await db.emailAccount.update({ where: { id: account.id }, data: { lastVerifiedAt: new Date(), lastError: null } });
      revalidate();
      return success({ ok: true, message: "Conexão verificada com sucesso." });
    } catch (e) {
      const err = normalizeSmtpError(e);
      console.error(`[email] teste de conexão falhou: ${err.code}`);
      await db.emailAccount.update({ where: { id: account.id }, data: { lastError: sanitizeError(err.userMessage) } });
      revalidate();
      return success({ ok: false, message: err.userMessage });
    } finally {
      clearTimeout(timer);
    }
  });
}
