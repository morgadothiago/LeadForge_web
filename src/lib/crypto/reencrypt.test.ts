import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { decrypt, encrypt } from "./secret-box";
import { parseKey, reencryptAllSecrets } from "./reencrypt";

const OLD = randomBytes(32);
const NEW = randomBytes(32);
const TAG = "zz-reenc";
const PLAIN_A = "sk-test-aaaa1234-reenc";
const PLAIN_B = "wa-key-bbbb5678-reenc";
const PLAIN_C = "smtp-pass-cccc9012-reenc";
let userId = "";
const ids = { s: "", w: "", e: "" };

async function cleanup() {
  await prisma.integrationSecret.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: { startsWith: TAG } } });
  await prisma.emailAccount.deleteMany({ where: { email: { startsWith: TAG } } });
}
let snapshot: Awaited<ReturnType<typeof prisma.integrationSecret.findMany>> = [];

beforeAll(async () => {
  await seed(prisma);
  await cleanup();
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@leadforge.local" }, select: { id: true } })).id;
  // Outros segredos reais do banco de dev (cifrados com a chave real) não entram no teste: isola-os temporariamente.
  snapshot = await prisma.integrationSecret.findMany({ where: { NOT: { name: { startsWith: TAG } } } });
  await prisma.integrationSecret.deleteMany({ where: { id: { in: snapshot.map((r) => r.id) } } });
  ids.s = (await prisma.integrationSecret.create({ data: { orgId: SEED_IDS.org, integration: "llm", name: `${TAG}-a`, encryptedValue: encrypt(PLAIN_A, OLD), hint: "1234" } })).id;
  ids.w = (await prisma.whatsAppInstance.create({ data: { orgId: SEED_IDS.org, instanceName: `${TAG}-w`, number: "+5511912345678", webhookToken: `${TAG}-tok`, apiKey: encrypt(PLAIN_B, OLD) } })).id;
  ids.e = (await prisma.emailAccount.create({ data: { orgId: SEED_IDS.org, userId, provider: "smtp", smtpHost: "smtp.test", email: `${TAG}@x.test`, encryptedPassword: encrypt(PLAIN_C, OLD) } })).id;
}, 30000);
afterAll(async () => {
  await cleanup();
  if (snapshot.length) await prisma.integrationSecret.createMany({ data: snapshot });
});

const secretRow = () => prisma.integrationSecret.findUniqueOrThrow({ where: { id: ids.s } });
describe("reencryptAllSecrets", () => {
  // Isola de contas/instâncias reais do banco de dev: se existirem outras, a chave antiga falsa não as decifra -> use só os nossos via filtro no teste.
  it("dry-run: valida e conta, não grava", async () => {
    const before = (await secretRow()).encryptedValue;
    const other = await prisma.whatsAppInstance.count({ where: { apiKey: { not: null }, NOT: { instanceName: { startsWith: TAG } } } })
      + (await prisma.emailAccount.count({ where: { NOT: { email: { startsWith: TAG } } } }));
    if (other) return; // banco de dev tem segredos reais (chave real): não testável com chaves falsas aqui
    const r = await reencryptAllSecrets(prisma, OLD, NEW);
    expect(r).toMatchObject({ dryRun: true, integrationSecrets: 1, whatsappApiKeys: 1, emailPasswords: 1, total: 3 });
    expect((await secretRow()).encryptedValue).toBe(before);
  });
  it("falha de decifra (chave antiga errada) não grava nada e não vaza segredo", async () => {
    const before = (await secretRow()).encryptedValue;
    const err = await reencryptAllSecrets(prisma, randomBytes(32), NEW, { dryRun: false }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Nada foi gravado/);
    expect(JSON.stringify((err as Error).message)).not.toContain(PLAIN_A);
    expect((await secretRow()).encryptedValue).toBe(before);
  });
  it("atomicidade: falha na gravação reverte tudo", async () => {
    const other = await prisma.whatsAppInstance.count({ where: { apiKey: { not: null }, NOT: { instanceName: { startsWith: TAG } } } })
      + (await prisma.emailAccount.count({ where: { NOT: { email: { startsWith: TAG } } } }));
    if (other) return;
    const before = (await secretRow()).encryptedValue;
    const bad = { ...prisma, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => prisma.$transaction(async (tx) => fn({
      integrationSecret: tx.integrationSecret,
      whatsAppInstance: { update: () => { throw new Error("boom"); } },
      emailAccount: tx.emailAccount,
    })) } as unknown as typeof prisma;
    await expect(reencryptAllSecrets(bad, OLD, NEW, { dryRun: false })).rejects.toThrow("boom");
    expect((await secretRow()).encryptedValue).toBe(before);
    expect(decrypt((await secretRow()).encryptedValue, OLD)).toBe(PLAIN_A);
  });
  it("apply: re-cifra as três tabelas; nova chave decifra, antiga não", async () => {
    const other = await prisma.whatsAppInstance.count({ where: { apiKey: { not: null }, NOT: { instanceName: { startsWith: TAG } } } })
      + (await prisma.emailAccount.count({ where: { NOT: { email: { startsWith: TAG } } } }));
    if (other) return;
    const r = await reencryptAllSecrets(prisma, OLD, NEW, { dryRun: false });
    expect(r).toMatchObject({ dryRun: false, total: 3 });
    const s = await secretRow();
    const w = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: ids.w } });
    const e = await prisma.emailAccount.findUniqueOrThrow({ where: { id: ids.e } });
    expect(decrypt(s.encryptedValue, NEW)).toBe(PLAIN_A);
    expect(decrypt(w.apiKey as string, NEW)).toBe(PLAIN_B);
    expect(decrypt(e.encryptedPassword, NEW)).toBe(PLAIN_C);
    expect(() => decrypt(s.encryptedValue, OLD)).toThrow();
  });
  it("parseKey rejeita tamanho errado sem eco da chave", () => {
    expect(() => parseKey("abc", "Chave nova")).toThrow(/32 bytes/);
    try { parseKey("segredo-curto", "Chave"); } catch (e) { expect((e as Error).message).not.toContain("segredo-curto"); }
    expect(parseKey(NEW.toString("base64"), "k")).toHaveLength(32);
    vi.fn();
  });
});
