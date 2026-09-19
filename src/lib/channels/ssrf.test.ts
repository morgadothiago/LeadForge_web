import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_HOST_MESSAGE, isBlockedIp, resolvePublicHost } from "./ssrf";
import { buildTransport } from "./email";
import type { EmailAccount } from "@prisma/client";

afterEach(() => {
  delete process.env.ALLOW_PRIVATE_SMTP_HOSTS;
});

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "127.9.9.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
  ])("bloqueia %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "1.1.1.1", "2606:4700::1111"])("permite %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("resolvePublicHost", () => {
  it("bloqueia IP literal interno com mensagem PT-BR", async () => {
    await expect(resolvePublicHost("127.0.0.1")).rejects.toMatchObject({ userMessage: BLOCKED_HOST_MESSAGE });
    expect(BLOCKED_HOST_MESSAGE).toBe("Host não permitido: aponta para rede interna.");
  });
  it("bloqueia nome que resolve para IP interno (mesmo se houver um IP público junto)", async () => {
    await expect(resolvePublicHost("evil.example", async () => ["8.8.8.8", "10.0.0.5"])).rejects.toMatchObject({ userMessage: BLOCKED_HOST_MESSAGE });
    await expect(resolvePublicHost("meta.example", async () => ["169.254.169.254"])).rejects.toMatchObject({ code: "config" });
  });
  it("devolve o IP checado para conectar nele (anti-rebinding)", async () => {
    await expect(resolvePublicHost("smtp.ok", async () => ["8.8.4.4"])).resolves.toBe("8.8.4.4");
  });
  it("falha de DNS vira erro de rede (ENOTFOUND)", async () => {
    await expect(resolvePublicHost("x.invalid", async () => { throw new Error("nx"); })).rejects.toMatchObject({ code: "ENOTFOUND" });
  });
  it("ALLOW_PRIVATE_SMTP_HOSTS=true libera; default (ausente/false) bloqueia", async () => {
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    await expect(resolvePublicHost("127.0.0.1")).resolves.toBe("127.0.0.1");
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "false";
    await expect(resolvePublicHost("127.0.0.1")).rejects.toBeTruthy();
  });
});

describe("buildTransport", () => {
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString("base64");
  it("conecta no IP checado com servername do host original; bloqueia interno", async () => {
    const { encrypt } = await import("@/lib/crypto/secret-box");
    const acc = (host: string) => ({ smtpHost: host, port: 587, email: "a@x.com", encryptedPassword: encrypt("p") }) as EmailAccount;
    const create = vi.fn(() => ({}) as never);
    await buildTransport(acc("smtp.ok"), { createTransport: create, resolveHost: async () => ["8.8.4.4"] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ host: "8.8.4.4", tls: { servername: "smtp.ok" } }));
    await expect(buildTransport(acc("smtp.evil"), { createTransport: create, resolveHost: async () => ["192.168.0.9"] })).rejects.toMatchObject({ userMessage: BLOCKED_HOST_MESSAGE });
  });
});
