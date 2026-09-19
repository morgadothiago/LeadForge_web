import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { createTemplate, deleteTemplate, previewTemplate, updateTemplate } from "./template";
import { createSequence, deleteSequence, duplicateSequence, reorderSteps, saveSequenceSteps } from "./sequence";
import { getSequence, listSequences, listTemplates, previewSequence } from "@/lib/queries/sequences";

const TAG = "zz-test-spec006";
let camp2 = "";
let tEmail = "";
let tWa = "";
let tOther = "";
let seqId = "";

beforeAll(async () => {
  await seed(prisma);
  await signInAsSeedAdmin();
  const c = await prisma.campaign.create({
    data: { name: `${TAG} c2`, icpId: SEED_IDS.icp, userId: SEED_IDS.user, status: "paused" },
  });
  camp2 = c.id;
  const mk = async (campaignId: string, channel: "email" | "whatsapp", name: string) => {
    const r = await createTemplate({
      campaignId,
      channel,
      name: `${TAG} ${name}`,
      subject: channel === "email" ? "Oi {{name}}" : null,
      body: "Olá {{name}} de {{company}}",
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.data.id;
  };
  tEmail = await mk(SEED_IDS.campaign, "email", "e");
  tWa = await mk(SEED_IDS.campaign, "whatsapp", "w");
  tOther = await mk(camp2, "email", "o");
});

afterAll(async () => {
  await prisma.sequenceStep.deleteMany({ where: { sequence: { name: { startsWith: TAG } } } });
  await prisma.sequence.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.messageTemplate.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("templates", () => {
  it("valida variável desconhecida, assunto de e-mail e canal", async () => {
    const r = await createTemplate({ campaignId: SEED_IDS.campaign, channel: "email", name: "x", body: "{{foo}}" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.body?.[0]).toMatch(/Variável desconhecida: \{\{foo\}\}/);
      expect(r.errors.subject?.[0]).toBe("Assunto é obrigatório para e-mail.");
    }
    const w = await createTemplate({ campaignId: SEED_IDS.campaign, channel: "whatsapp", name: "x", subject: "s", body: "b" });
    expect(w.ok).toBe(false);
  });
  it("lista por campanha e preview server-side", async () => {
    const list = await listTemplates(SEED_IDS.campaign, "whatsapp");
    expect(list.every((t) => t.channel === "whatsapp")).toBe(true);
    const p = await previewTemplate({ campaignId: SEED_IDS.campaign, channel: "email", name: "x", subject: "Oi {{name}}", body: "Olá {{name}} {{company}}" });
    expect(p.ok && p.data.subject).toBe("Oi Maria Silva");
  });
});

describe("sequência", () => {
  it("cria 0/2/5/7/10 na ordem", async () => {
    const days = [0, 2, 5, 7, 10];
    const r = await createSequence({ name: `${TAG} s`, steps: days.map((day) => ({ day, channel: "email", templateId: tEmail })) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    seqId = r.data.id;
    const s = await getSequence(seqId);
    expect(s?.steps.map((x) => [x.order, x.day])).toEqual(days.map((d, i) => [i, d]));
  });
  it("rejeita dias decrescentes, canal incompatível e templates de campanhas diferentes", async () => {
    const a = await createSequence({ name: `${TAG} a`, steps: [{ day: 3, channel: "email", templateId: tEmail }, { day: 1, channel: "email", templateId: tEmail }] });
    expect(!a.ok && a.errors["steps.1.day"]).toBeTruthy();
    const b = await createSequence({ name: `${TAG} b`, steps: [{ day: 0, channel: "email", templateId: tWa }] });
    expect(!b.ok && b.errors["steps.0.templateId"]?.[0]).toMatch(/canal/);
    const c = await createSequence({ name: `${TAG} c`, steps: [{ day: 0, channel: "email", templateId: tEmail }, { day: 1, channel: "email", templateId: tOther }] });
    expect(!c.ok && c.errors.steps?.[0]).toMatch(/mesma campanha/);
  });
  it("reordena em transação (ids preservados) e recusa dias decrescentes", async () => {
    const s = await getSequence(seqId);
    const ids = s!.steps.map((x) => x.id);
    const bad = await reorderSteps({ sequenceId: seqId, stepIds: [...ids].reverse() });
    expect(bad.ok).toBe(false);
    const eq = await createSequence({ name: `${TAG} eq`, steps: [0, 0, 0].map((day) => ({ day, channel: "email", templateId: tEmail })) });
    if (!eq.ok) throw new Error("x");
    const eqIds = (await getSequence(eq.data.id))!.steps.map((x) => x.id);
    const ok = await reorderSteps({ sequenceId: eq.data.id, stepIds: [eqIds[2], eqIds[0], eqIds[1]] });
    expect(ok.ok).toBe(true);
    expect((await getSequence(eq.data.id))!.steps.map((x) => x.id)).toEqual([eqIds[2], eqIds[0], eqIds[1]]);
  });
  it("saveSequenceSteps preserva/remove/cria passos", async () => {
    const s = await getSequence(seqId);
    const [a, , c] = s!.steps;
    const r = await saveSequenceSteps({
      sequenceId: seqId,
      steps: [
        { id: c.id, day: 1, channel: "email", templateId: tEmail },
        { day: 4, channel: "whatsapp", templateId: tWa },
        { id: a.id, day: 9, channel: "email", templateId: tEmail },
      ],
    });
    expect(r.ok).toBe(true);
    const after = await getSequence(seqId);
    expect(after!.steps.map((x) => [x.order, x.day])).toEqual([[0, 1], [1, 4], [2, 9]]);
    expect(after!.steps[0].id).toBe(c.id);
  });
  it("duplica com ids novos e independente", async () => {
    const d = await duplicateSequence(seqId);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const [o, n] = await Promise.all([getSequence(seqId), getSequence(d.data.id)]);
    expect(n!.id).not.toBe(o!.id);
    expect(n!.steps.map((x) => x.day)).toEqual(o!.steps.map((x) => x.day));
    expect(n!.steps.some((x) => o!.steps.some((y) => y.id === x.id))).toBe(false);
  });
  it("preview e listagem", async () => {
    const p = await previewSequence(seqId);
    expect(p).toHaveLength(3);
    expect(p![0].body.ok && p![0].body.text).toBe("Olá Maria Silva de Acme Ltda");
    expect((await listSequences()).find((x) => x.id === seqId)?.stepCount).toBe(3);
  });
});

describe("integridade", () => {
  it("template usado não exclui nem troca canal", async () => {
    const d = await deleteTemplate(tEmail);
    expect(!d.ok && d.errors._form?.[0]).toMatch(/Não é possível excluir/);
    const u = await updateTemplate({ id: tEmail, campaignId: SEED_IDS.campaign, channel: "whatsapp", name: `${TAG} e`, body: "x" });
    expect(u.ok).toBe(false);
    expect(await prisma.messageTemplate.count({ where: { id: tEmail } })).toBe(1);
  });
  it("sequência em campanha ativa não exclui", async () => {
    // A campanha do seed nasce PAUSADA (SPEC-013); a própria teste cria uma campanha ativa vinculada (limpa no afterAll por prefixo TAG).
    const own = await createSequence({ name: `${TAG} inuse`, steps: [] });
    if (!own.ok) throw new Error("x");
    await prisma.campaign.create({ data: { name: `${TAG} c-active`, icpId: SEED_IDS.icp, userId: SEED_IDS.user, status: "active", sequenceId: own.data.id } });
    const d = await deleteSequence(own.data.id);
    expect(!d.ok && d.errors._form?.[0]).toMatch(/campanha\(s\) ativa/);
    const free = await createSequence({ name: `${TAG} free`, steps: [] });
    if (!free.ok) throw new Error("x");
    expect((await deleteSequence(free.data.id)).ok).toBe(true);
  });
});

describe("safeAction: erros tratados (sem vazar detalhe interno)", () => {
  it("UnauthorizedError vira ActionResult PT-BR", async () => {
    const { UnauthorizedError } = await import("@/lib/auth/require-user");
    const auth = await import("@/lib/auth/require-user");
    const spy = vi.spyOn(auth, "requireUser").mockRejectedValueOnce(new UnauthorizedError());
    const r = await deleteSequence("x");
    spy.mockRestore();
    expect(r).toEqual({ ok: false, errors: { _form: ["Sessão expirada. Faça login novamente."] } });
  });
  it("P2025 (registro sumiu) não vaza mensagem interna", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleActionError } = await import("./result");
    const { Prisma } = await import("@prisma/client");
    const e = new Prisma.PrismaClientKnownRequestError("SECRET internal table detail", { code: "P2025", clientVersion: "x" });
    const r = handleActionError(e);
    expect(r).toEqual({ ok: false, errors: { _form: ["Registro não encontrado."] } });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    const g = handleActionError(new Error("SECRET boom"));
    expect(JSON.stringify(g)).not.toContain("SECRET");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("delete de sequência inexistente retorna erro tratado", async () => {
    const r = await deleteSequence("cl0000000000000000000000x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r)).not.toMatch(/prisma|invocation/i);
  });
  it("conflito de @@unique([sequenceId, order]) vira erro tratado", async () => {
    const s = await createSequence({
      name: `${TAG} uniq`,
      steps: [{ day: 0, channel: "email", templateId: tEmail }, { day: 1, channel: "email", templateId: tEmail }],
    });
    if (!s.ok) throw new Error("setup");
    const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: s.data.id }, orderBy: { order: "asc" } });
    const { Prisma } = await import("@prisma/client");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on (sequenceId, order) SECRET", {
        code: "P2002",
        clientVersion: "x",
      }),
    );
    const r = await reorderSteps({ sequenceId: s.data.id, stepIds: steps.map((x) => x.id) });
    vi.restoreAllMocks();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form).toEqual(["Já existe um registro com esses dados."]);
    expect(await prisma.sequenceStep.count({ where: { sequenceId: s.data.id } })).toBe(2);
  });
});
