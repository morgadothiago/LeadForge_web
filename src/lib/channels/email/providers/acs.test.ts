import { describe, expect, it, vi } from "vitest";
import { AcsEmailProvider } from "./acs";

/** SPEC-048 — EmailClient SEMPRE fake; o Azure real NUNCA é chamado nos testes. */
const INPUT = { to: "a@b.com", subject: "Assunto", html: "<p>Oi</p>", text: "Oi", from: "DoNotReply@dominio.com" };
const CONN = "endpoint=https://x.communication.azure.com/;accesskey=SEGREDO123";

type Client = NonNullable<ConstructorParameters<typeof AcsEmailProvider>[1]>["client"];
const fake = (beginSend: (m: unknown) => unknown) => ({ beginSend }) as unknown as Client;

describe("AcsEmailProvider", () => {
  it("sucesso: mapeia a mensagem (html+plainText, from, to) e devolve o id da operação", async () => {
    const beginSend = vi.fn(async () => ({ getOperationState: () => ({ result: { id: "op-1" } }) }));
    const p = new AcsEmailProvider(CONN, { client: fake(beginSend) });
    const r = await p.send(INPUT);
    expect(r.messageId).toBe("op-1");
    expect(beginSend).toHaveBeenCalledWith({
      senderAddress: INPUT.from,
      content: { subject: INPUT.subject, plainText: INPUT.text, html: INPUT.html },
      recipients: { to: [{ address: INPUT.to }] },
    });
    expect(p.name).toBe("acs");
  });

  it.each([
    [429, "rate_limited"],
    [401, "unauthorized"],
    [400, "upstream"],
    [503, "upstream"],
  ])("status %i vira AppError %s, sem vazar segredo", async (statusCode, code) => {
    const err = Object.assign(new Error(`falha ${CONN}`), { statusCode });
    const p = new AcsEmailProvider(CONN, { client: fake(async () => { throw err; }) });
    try {
      await p.send(INPUT);
      throw new Error("deveria lançar");
    } catch (e) {
      expect(e).toMatchObject({ code });
      expect(String((e as Error).message)).not.toContain("SEGREDO123");
      expect((e as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it("erro sem status (rede): AppError network retentável", async () => {
    const p = new AcsEmailProvider(CONN, { client: fake(async () => { throw new Error("boom"); }) });
    await expect(p.send(INPUT)).rejects.toMatchObject({ code: "network", retryable: true });
  });
});
