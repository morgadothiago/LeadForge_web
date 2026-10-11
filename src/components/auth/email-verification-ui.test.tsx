// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/auth", () => ({ resendVerificationEmail: vi.fn(), verifyEmail: vi.fn() }));

import { VerifyEmailBanner } from "./VerifyEmailBanner";
import { VerifyEmailResult } from "./VerifyEmailResult";
import { EMAIL_NOT_VERIFIED_MESSAGE, isEmailNotVerified, resendErrorMessage, retryAfterSeconds } from "./email-verification-ui";

describe("email-verification-ui helpers", () => {
  it("detecta email_not_verified e le retryAfterSeconds", () => {
    expect(isEmailNotVerified({ _form: ["x"], code: ["email_not_verified"] })).toBe(true);
    expect(isEmailNotVerified({ code: ["cooldown"] })).toBe(false);
    expect(isEmailNotVerified(undefined)).toBe(false);
    expect(retryAfterSeconds({ retryAfterSeconds: ["42"] })).toBe(42);
    expect(retryAfterSeconds({ retryAfterSeconds: ["x"] })).toBe(0);
    expect(retryAfterSeconds(undefined)).toBe(0);
  });
  it("mensagem de reenvio usa a do servidor com fallback", () => {
    expect(resendErrorMessage({ _form: ["Aguarde 10s"] })).toBe("Aguarde 10s");
    expect(resendErrorMessage({})).toMatch(/Tente novamente/);
    expect(EMAIL_NOT_VERIFIED_MESSAGE).toMatch(/Confirme seu e-mail/);
  });
});

describe("VerifyEmailBanner", () => {
  it("mostra o aviso, o botao Reenviar e nao tem botao de fechar", () => {
    const html = renderToStaticMarkup(<VerifyEmailBanner email="a@b.com" />);
    expect(html).toContain("Verifique seu e-mail para poder enviar mensagens");
    expect(html).toContain("Reenviar e-mail");
    expect(html).not.toMatch(/Fechar|aria-label="Dispensar/);
    expect(html).not.toContain('disabled=""');
  });
});

describe("VerifyEmailResult", () => {
  it("com token: estado de carregamento acessivel (role=status)", () => {
    const html = renderToStaticMarkup(<VerifyEmailResult token={"a".repeat(32)} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Confirmando seu e-mail");
  });
  it("sem token: erro direto (role=alert) com link para o login", () => {
    const html = renderToStaticMarkup(<VerifyEmailResult />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Link de confirmação inválido");
    expect(html).toContain('href="/login"');
  });
});
