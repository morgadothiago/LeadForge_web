import nodemailer, { type Transporter } from "nodemailer";
import { describe, expect, it, afterEach } from "vitest";
import { sendSystemEmail, systemSmtpConfigured, type EmailContent } from "./system-mail";
import type { EmailProvider } from "./email/provider";

const ORIGINAL = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  resendKey: process.env.RESEND_API_KEY,
};

const CONTENT: EmailContent = { html: "<p>Corpo</p>", text: "Corpo" };

afterEach(() => {
  process.env.SMTP_HOST = ORIGINAL.host;
  process.env.SMTP_PORT = ORIGINAL.port;
  process.env.SMTP_USER = ORIGINAL.user;
  process.env.SMTP_PASS = ORIGINAL.pass;
  process.env.RESEND_API_KEY = ORIGINAL.resendKey;
  delete process.env.ALLOW_PRIVATE_SMTP_HOSTS;
});

describe("systemSmtpConfigured", () => {
  it("false sem SMTP_HOST; true com SMTP_HOST", () => {
    delete process.env.SMTP_HOST;
    expect(systemSmtpConfigured()).toBe(false);
    process.env.SMTP_HOST = "smtp.example.com";
    expect(systemSmtpConfigured()).toBe(true);
  });
});

describe("sendSystemEmail — sem RESEND_API_KEY (SMTP direto, comportamento preservado da SPEC-038)", () => {
  it("sem SMTP_HOST: falha com erro de config, nunca lança", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    const r = await sendSystemEmail("a@b.com", "assunto", CONTENT, "password_reset");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("config");
  });

  it("host bloqueado por SSRF (rede interna): falha com erro de config, credencial nunca aparece", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "segredo-super-secreto";
    delete process.env.ALLOW_PRIVATE_SMTP_HOSTS;
    const r = await sendSystemEmail("a@b.com", "assunto", CONTENT, "password_reset", { resolveHost: async () => ["127.0.0.1"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.userMessage).not.toContain("segredo-super-secreto");
      expect(r.error.userMessage).toMatch(/rede interna/);
    }
  });

  it("com ALLOW_PRIVATE_SMTP_HOSTS=true e transport jsonTransport: envia com sucesso", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "senha";
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const r = await sendSystemEmail("destino@x.com", "Assunto", CONTENT, "password_reset", { transport });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBeTruthy();
  });

  it("createTransport recebe a config final (host resolvido) e nunca a senha exposta no retorno", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "u@example.com";
    process.env.SMTP_PASS = "senha-secreta";
    let seenCfg: unknown;
    const jt = nodemailer.createTransport({ jsonTransport: true });
    const r = await sendSystemEmail("d@x.com", "S", CONTENT, "password_reset", {
      resolveHost: async () => ["93.184.216.34"], // IP público qualquer (não bloqueado)
      createTransport: (cfg) => {
        seenCfg = cfg;
        return jt;
      },
    });
    expect(r.ok).toBe(true);
    expect(seenCfg).toMatchObject({ secure: true, tls: { servername: "smtp.example.com" } });
  });

  it("falha SMTP (transport que lança) é normalizada em AppError PT-BR", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    const throwing = {
      sendMail: async () => {
        throw Object.assign(new Error("boom"), { code: "EAUTH" });
      },
    } as unknown as Transporter;
    const r = await sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", { transport: throwing });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("unauthorized");
      expect(r.error.userMessage).toMatch(/autenticação/);
    }
  });

  it("envia o HTML e o texto (multipart) recebidos, sem alterar o conteúdo", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    let sent: { html?: string; text?: string } = {};
    const fake = {
      sendMail: async (mail: { html?: string; text?: string }) => {
        sent = mail;
        return { messageId: "abc" };
      },
    } as unknown as Transporter;
    const r = await sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", { transport: fake });
    expect(r.ok).toBe(true);
    expect(sent.html).toBe(CONTENT.html);
    expect(sent.text).toBe(CONTENT.text);
  });
});

describe("sendSystemEmail — com RESEND_API_KEY (Resend primário, fallback SMTP em erro/timeout, D-046-2)", () => {
  it("Resend responde com sucesso: usa o messageId do Resend, nunca toca o SMTP", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fakeResend: EmailProvider = { name: "resend", send: async () => ({ messageId: "resend-msg-1" }) };
    const fakeSmtp: EmailProvider = {
      name: "smtp",
      send: async () => {
        throw new Error("SMTP não deveria ser chamado");
      },
    };
    const r = await sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", { primaryProvider: fakeResend, fallbackProvider: fakeSmtp });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBe("resend-msg-1");
  });

  it("Resend lança erro: cai automaticamente para o fallback SMTP e ainda retorna sucesso", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fakeResend: EmailProvider = {
      name: "resend",
      send: async () => {
        throw new Error("Resend indisponível");
      },
    };
    const fakeSmtp: EmailProvider = { name: "smtp", send: async () => ({ messageId: "smtp-fallback-1" }) };
    const r = await sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", { primaryProvider: fakeResend, fallbackProvider: fakeSmtp });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBe("smtp-fallback-1");
  });

  it("Resend expira (timeout): cai automaticamente para o fallback SMTP", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fakeResend: EmailProvider = {
      name: "resend",
      send: () => new Promise(() => {}), // nunca resolve — simula travamento/timeout.
    };
    const fakeSmtp: EmailProvider = { name: "smtp", send: async () => ({ messageId: "smtp-fallback-timeout" }) };
    const r = await sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", {
      primaryProvider: fakeResend,
      fallbackProvider: fakeSmtp,
      resendTimeoutMs: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBe("smtp-fallback-timeout");
  });

  it("Resend E o fallback SMTP falham: retorna {ok:false}, nunca lança (best-effort até o fim)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fakeResend: EmailProvider = {
      name: "resend",
      send: async () => {
        throw new Error("Resend indisponível");
      },
    };
    const fakeSmtp: EmailProvider = {
      name: "smtp",
      send: async () => {
        throw Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" });
      },
    };
    await expect(sendSystemEmail("a@b.com", "s", CONTENT, "password_reset", { primaryProvider: fakeResend, fallbackProvider: fakeSmtp })).resolves.toMatchObject({
      ok: false,
    });
  });
});
