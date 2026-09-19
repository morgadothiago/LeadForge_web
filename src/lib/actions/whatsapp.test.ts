import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp/provider")>()), getWhatsAppProvider: () => fake.current }));

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://app.test";

import { prisma } from "@/lib/prisma";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import { decrypt } from "@/lib/crypto/secret-box";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import {
  createWhatsAppInstance, deleteWhatsAppInstance, disconnectInstance, getInstanceQr, getInstanceWebhookConfig, refreshInstanceStatus, updateInstance,
} from "./whatsapp";
import { getWhatsAppInstance, listWhatsAppInstances } from "@/lib/queries/whatsapp";
import { createCampaign } from "./campaign";

const TAG = "zz-spec011a";
const NUMBER = "(11) 91234-5678";
let f: FakeWhatsAppProvider;

beforeAll(async () => {
  await seed(prisma);
  await signInAsSeedAdmin();
}, 30000);
afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { name: TAG } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: { startsWith: TAG } } });
  await prisma.$disconnect();
});

const mk = async (suffix: string) => {
  f = new FakeWhatsAppProvider();
  fake.current = f;
  const r = await createWhatsAppInstance({ instanceName: `${TAG}-${suffix}`, number: NUMBER });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.data.id;
};

describe("actions/queries WhatsApp", () => {
  it("cria: número E.164, token 32 bytes base64url, apiKey cifrada, sem segredos nas queries", async () => {
    const id = await mk("a");
    const row = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ number: "+5511912345678", dailyLimit: 30, status: "connecting", provider: "evolution" });
    expect(Buffer.from(row.webhookToken, "base64url")).toHaveLength(32);
    expect(row.apiKey).not.toContain("fake-key");
    expect(decrypt(row.apiKey!)).toBe(`fake-key-${TAG}-a`);
    expect(f.created[0]).toMatchObject({ webhookUrl: `http://app.test/api/webhooks/whatsapp/${row.webhookToken}` });
    const list = JSON.stringify(await listWhatsAppInstances());
    expect(list).not.toContain(row.webhookToken);
    expect(list).not.toContain(row.apiKey!);
    expect(list).not.toContain("fake-key");
    const v = await getWhatsAppInstance(id);
    expect(v).toMatchObject({ hasApiKey: true, webhookTokenHint: `…${row.webhookToken.slice(-4)}`, campaignCount: 0 });
    const cfg = await getInstanceWebhookConfig(id);
    expect(cfg).toEqual({ ok: true, data: { url: `http://app.test/api/webhooks/whatsapp/${row.webhookToken}`, token: row.webhookToken } });
  });

  it("valida: nome duplicado, número inválido, limite fora de 1-40, nome inválido", async () => {
    await mk("dup");
    expect(await createWhatsAppInstance({ instanceName: `${TAG}-dup`, number: NUMBER })).toMatchObject({ ok: false, errors: { instanceName: [expect.stringMatching(/Já existe/)] } });
    expect(f.created).toHaveLength(1); // duplicado não chama o provider
    expect(await createWhatsAppInstance({ instanceName: `${TAG}-x`, number: "123" })).toMatchObject({ ok: false, errors: { number: [expect.stringMatching(/Telefone inválido/)] } });
    expect(await createWhatsAppInstance({ instanceName: "a b", number: NUMBER })).toMatchObject({ ok: false });
    expect(await createWhatsAppInstance({ instanceName: `${TAG}-y`, number: NUMBER, dailyLimit: 41 })).toMatchObject({ ok: false, errors: { dailyLimit: [expect.stringMatching(/máximo/)] } });
  });

  it("updateInstance: dailyLimit 1-40 e número", async () => {
    const id = await mk("upd");
    expect(await updateInstance({ id, dailyLimit: 0 })).toMatchObject({ ok: false });
    expect(await updateInstance({ id, dailyLimit: 41 })).toMatchObject({ ok: false });
    expect(await updateInstance({ id, dailyLimit: 40, number: "11 98888-7777" })).toMatchObject({ ok: true });
    expect(await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id } })).toMatchObject({ dailyLimit: 40, number: "+5511988887777" });
    expect(await updateInstance({ id: "00000000-0000-4000-8000-000000000000", dailyLimit: 5 })).toMatchObject({ ok: false });
  });

  it("QR, status (connected grava lastConnectedAt), disconnect", async () => {
    const id = await mk("qr");
    expect(await getInstanceQr(id)).toEqual({ ok: true, data: { qrCode: "data:image/png;base64,FAKE", pairingCode: null } });
    expect(await refreshInstanceStatus(id)).toEqual({ ok: true, data: { status: "connected" } });
    const row = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("connected");
    expect(row.lastConnectedAt).toBeTruthy();
    expect(await disconnectInstance(id)).toMatchObject({ ok: true });
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id } })).status).toBe("disconnected");
  });

  it("erro do provider: mensagem PT-BR, lastError sanitizado", async () => {
    const id = await mk("err");
    const { AppError } = await import("@/lib/errors");
    f.getStatus = async () => { throw new AppError({ code: "network", userMessage: "Não foi possível conectar a WhatsApp (Evolution)." }); };
    const r = await refreshInstanceStatus(id);
    expect(r).toMatchObject({ ok: false, errors: { _form: [expect.stringMatching(/Não foi possível conectar/)] } });
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id } })).lastError).toMatch(/conectar/);
  });

  it("delete bloqueado com campanha usando; libera após desvincular; chama provider", async () => {
    const id = await mk("del");
    const icp = await prisma.icpProfile.findFirstOrThrow();
    const c = await createCampaign({ name: TAG, icpId: icp.id, whatsappInstanceId: id });
    expect(c.ok).toBe(true);
    const blocked = await deleteWhatsAppInstance(id);
    expect(blocked).toMatchObject({ ok: false, errors: { _form: [expect.stringMatching(/1 campanha usa/)] } });
    expect(f.deleted).toHaveLength(0);
    await prisma.campaign.updateMany({ where: { name: TAG }, data: { whatsappInstanceId: null } });
    expect(await deleteWhatsAppInstance(id)).toMatchObject({ ok: true });
    expect(f.deleted).toEqual([`${TAG}-del`]);
    expect(await prisma.whatsAppInstance.count({ where: { id } })).toBe(0);
  });
});
