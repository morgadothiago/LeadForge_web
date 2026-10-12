// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/actions/billing", () => ({ signUp: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ resetPassword: vi.fn() }));
vi.mock("@/lib/actions/org", () => ({ acceptInvite: vi.fn(), signUpAndJoin: vi.fn(), previewInvite: vi.fn() }));

import { PasswordStrength } from "./PasswordStrength";
import { SignupForm } from "./SignupForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { InviteSignupForm } from "@/components/org/InviteLanding";

describe("PasswordStrength (SSR)", () => {
  it("vazio: so a dica generica; com senha: texto + aria-live, sem vazar a senha", () => {
    const empty = renderToStaticMarkup(<PasswordStrength password="" />);
    expect(empty).toContain('aria-live="polite"');
    expect(empty).not.toContain("Força:");
    const weak = renderToStaticMarkup(<PasswordStrength password="123456" />);
    expect(weak).toContain("Força: Muito fraca.");
    expect(weak).toContain("senha muito fraca");
    expect(weak).not.toContain("value=");
    expect(renderToStaticMarkup(<PasswordStrength password="Tr0ca-Esta-Chave!" />)).toContain("Força: Forte.");
  });
  it("renderiza 4 segmentos", () => {
    expect(renderToStaticMarkup(<PasswordStrength password="abc" />).match(/h-1\.5 flex-1/g)).toHaveLength(4);
  });
});

describe("Formularios com senha (SSR)", () => {
  const expectPair = (html: string) => {
    expect(html).toContain("Mínimo de 6 caracteres.");
    expect(html).not.toContain("12 caracteres");
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Mostrar senha"/g)).toHaveLength(2);
    expect(html).toContain("Confirmar");
    expect(html).toContain('data-testid="password-strength"');
  };
  it("SignupForm", () => expectPair(renderToStaticMarkup(<SignupForm />)));
  it("ResetPasswordForm", () => expectPair(renderToStaticMarkup(<ResetPasswordForm token="t" />)));
  it("InviteSignupForm", () => expectPair(renderToStaticMarkup(<InviteSignupForm token="t" email="a@b.com" />)));
});
