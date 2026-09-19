import type { PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "./secret-box";

export interface ReencryptResult {
  dryRun: boolean;
  integrationSecrets: number;
  whatsappApiKeys: number;
  emailPasswords: number;
  total: number;
}

/** Converte a chave em base64 (32 bytes) para Buffer; NUNCA inclui a chave na mensagem de erro. */
export function parseKey(b64: string | undefined, label: string): Buffer {
  const k = Buffer.from((b64 ?? "").trim(), "base64");
  if (k.length !== 32) throw new Error(`${label} inválida: deve ter 32 bytes em base64.`);
  return k;
}

/**
 * Rotação da ENCRYPTION_KEY (SPEC-018): re-cifra IntegrationSecret.encryptedValue, WhatsAppInstance.apiKey e EmailAccount.encryptedPassword.
 * TUDO-OU-NADA: primeiro decifra e re-cifra todos em memória (verificando que a nova chave decifra ao mesmo texto); qualquer falha lança
 * ANTES de gravar; a gravação é uma única transação. `dryRun` (padrão) só valida e conta. Nunca loga valores.
 * Limitação: escritas concorrentes durante a rotação podem ser sobrescritas; rode com o app parado/em manutenção.
 */
export async function reencryptAllSecrets(
  db: PrismaClient,
  oldKey: Buffer,
  newKey: Buffer,
  opts: { dryRun?: boolean } = {},
): Promise<ReencryptResult> {
  const dryRun = opts.dryRun ?? true;
  const conv = (payload: string, where: string): string => {
    let plain: string;
    try {
      plain = decrypt(payload, oldKey);
    } catch {
      throw new Error(`Falha ao decifrar com a chave antiga em ${where}. Nada foi gravado.`);
    }
    const next = encrypt(plain, newKey);
    if (decrypt(next, newKey) !== plain) throw new Error(`Verificação de re-cifragem falhou em ${where}. Nada foi gravado.`);
    return next;
  };
  const secrets = await db.integrationSecret.findMany({ select: { id: true, encryptedValue: true } });
  const wa = await db.whatsAppInstance.findMany({ where: { apiKey: { not: null } }, select: { id: true, apiKey: true } });
  const mail = await db.emailAccount.findMany({ select: { id: true, encryptedPassword: true } });
  const s2 = secrets.map((r) => ({ id: r.id, v: conv(r.encryptedValue, "IntegrationSecret") }));
  const w2 = wa.map((r) => ({ id: r.id, v: conv(r.apiKey as string, "WhatsAppInstance.apiKey") }));
  const m2 = mail.map((r) => ({ id: r.id, v: conv(r.encryptedPassword, "EmailAccount.encryptedPassword") }));
  const result: ReencryptResult = {
    dryRun, integrationSecrets: s2.length, whatsappApiKeys: w2.length, emailPasswords: m2.length, total: s2.length + w2.length + m2.length,
  };
  if (dryRun) return result;
  await db.$transaction(async (tx) => {
    for (const r of s2) await tx.integrationSecret.update({ where: { id: r.id }, data: { encryptedValue: r.v } });
    for (const r of w2) await tx.whatsAppInstance.update({ where: { id: r.id }, data: { apiKey: r.v } });
    for (const r of m2) await tx.emailAccount.update({ where: { id: r.id }, data: { encryptedPassword: r.v } });
  }, { timeout: 60_000 });
  return result;
}
