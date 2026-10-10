// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const preview = vi.fn();
const user = vi.fn();
vi.mock("@/lib/actions/org", () => ({ previewInvite: (...a: unknown[]) => preview(...a) }));
vi.mock("@/lib/auth/require-user", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUser: () => user() };
});
vi.mock("@/components/org/InviteLanding", () => ({ InviteLanding: () => null }));

import InvitePage from "./[token]/page";
import { UnauthorizedError } from "@/lib/auth/require-user";

async function stateOf(token = "tok") {
  const el = (await InvitePage({ params: Promise.resolve({ token }) })) as { props: { children: unknown } };
  // main > div > [header div, InviteLanding]
  const card = (el.props.children as { props: { children: unknown[] } }).props.children;
  return (card[1] as { props: { token: string; state: { kind: string } } }).props;
}

const valid = (userExists: boolean) => ({ ok: true, data: { valid: true, orgName: "Acme", email: "Ana@X.com", orgRole: "member", userExists } });

describe("/convite/[token] (SPEC-049b)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("inválido -> estado genérico; não consulta a sessão", async () => {
    preview.mockResolvedValue({ ok: true, data: { valid: false } });
    expect((await stateOf()).state.kind).toBe("invalid");
    expect(user).not.toHaveBeenCalled();
  });
  it("rate limit/erro do preview -> estado de erro", async () => {
    preview.mockResolvedValue({ ok: false, errors: { _form: ["Muitas tentativas."] } });
    expect((await stateOf()).state).toEqual({ kind: "error", message: "Muitas tentativas." });
  });
  it("deslogado: e-mail novo -> signup; e-mail existente -> login", async () => {
    user.mockRejectedValue(new UnauthorizedError());
    preview.mockResolvedValue(valid(false));
    expect((await stateOf()).state.kind).toBe("signup");
    preview.mockResolvedValue(valid(true));
    expect((await stateOf()).state.kind).toBe("login");
  });
  it("logado: e-mail igual (case-insensitive) -> accept; outro -> wrong-account; platform_admin -> wrong-account", async () => {
    preview.mockResolvedValue(valid(true));
    user.mockResolvedValue({ email: "ana@x.com", platformRole: "provider" });
    expect((await stateOf()).state.kind).toBe("accept");
    user.mockResolvedValue({ email: "bia@x.com", platformRole: "provider" });
    expect((await stateOf()).state.kind).toBe("wrong-account");
    user.mockResolvedValue({ email: "ana@x.com", platformRole: "platform_admin" });
    expect((await stateOf()).state.kind).toBe("wrong-account");
  });
  it("decodifica o token da URL", async () => {
    preview.mockResolvedValue({ ok: true, data: { valid: false } });
    await stateOf("a%2Bb");
    expect(preview).toHaveBeenCalledWith({ token: "a+b" });
  });
});
