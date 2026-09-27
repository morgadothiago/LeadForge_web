import { describe, expect, it } from "vitest";
import { ResendEmailProvider } from "./resend";

/** SPEC-046 — cliente Resend SEMPRE injetado (fake); a API real do Resend NUNCA é chamada nos testes. */
const INPUT = { to: "a@b.com", subject: "Assunto", html: "<p>Oi</p>", text: "Oi", from: "no-reply@leadforge.local" };

describe("ResendEmailProvider", () => {
  it("sucesso: devolve o messageId retornado pelo cliente", async () => {
    const client = { send: async () => ({ data: { id: "resend-id-1" }, error: null, headers: null }) };
    const provider = new ResendEmailProvider("re_fake", { client });
    const r = await provider.send(INPUT);
    expect(r.messageId).toBe("resend-id-1");
  });

  it("erro reportado pela API: lança AppError code=upstream, sem vazar o corpo cru no userMessage", async () => {
    const client = {
      send: async () => ({
        data: null,
        error: { message: "invalid_from_address: domínio não verificado", statusCode: 422, name: "validation_error" as const },
        headers: null,
      }),
    };
    const provider = new ResendEmailProvider("re_fake", { client });
    await expect(provider.send(INPUT)).rejects.toMatchObject({ code: "upstream" });
    try {
      await provider.send(INPUT);
      throw new Error("deveria ter lançado");
    } catch (e) {
      expect((e as { userMessage?: string }).userMessage).not.toContain("domínio não verificado");
    }
  });

  it("cliente lança (rede/timeout): propaga o erro cru (quem normaliza é system-mail.ts)", async () => {
    const client = {
      send: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ETIMEDOUT" });
      },
    };
    const provider = new ResendEmailProvider("re_fake", { client });
    await expect(provider.send(INPUT)).rejects.toThrow("fetch failed");
  });

  it("name é 'resend'", () => {
    const provider = new ResendEmailProvider("re_fake", { client: { send: async () => ({ data: { id: "x" }, error: null, headers: null }) } });
    expect(provider.name).toBe("resend");
  });
});
