// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const preview = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/actions/account-deletion", () => ({
  cancelAccountDeletion: vi.fn(),
  requestAccountDeletion: vi.fn(),
  confirmAccountDeletion: vi.fn(),
  cancelAccountDeletionByToken: vi.fn(),
  cancelAccountDeletionWithPassword: vi.fn(),
  previewAccountDeletionToken: preview,
}));
vi.mock("@/lib/actions/auth", () => ({ login: vi.fn() }));

import { DeleteAccountPanel, type DeletionPanelState } from "./DeleteAccountPanel";
import { DeletionTokenLanding } from "./DeletionTokenLanding";
import { loadDeletionLandingState } from "./deletion-landing-state";
import { LoginForm } from "@/components/auth/LoginForm";
import { blockerTitle, deletionErrorMessage, errorCode, formatDeletionDate } from "./deletion-format";
import { ANONYMIZED_ITEMS, DELETED_ITEMS, RETAINED_ITEMS } from "@/lib/account-deletion/retention";

const base: DeletionPanelState = { status: "none", confirmationExpiresAt: null, scheduledFor: null, windowDays: 30, blockers: [], canRequest: true };

describe("deletion-format", () => {
  it("formata data em DD/MM/AAAA (UTC) a partir de Date ou ISO", () => {
    expect(formatDeletionDate("2026-11-09T12:00:00.000Z")).toBe("09/11/2026");
    expect(formatDeletionDate(new Date("2026-11-09T23:30:00Z"))).toBe("09/11/2026");
  });
  it("codigo, mensagem e titulo de bloqueio", () => {
    expect(errorCode({ code: ["blocked"], _form: ["x"] })).toBe("blocked");
    expect(errorCode(undefined)).toBeUndefined();
    expect(deletionErrorMessage({ _form: ["a", "b"], code: ["blocked"] })).toBe("a b");
    expect(deletionErrorMessage({ code: ["rate_limited"] })).toMatch(/Tente novamente/);
    expect(blockerTitle("active_subscription")).toBe("Assinatura ativa");
    expect(blockerTitle("desconhecido")).toBe("Exclusão bloqueada");
  });
});

describe("DeleteAccountPanel (SSR)", () => {
  it("none: explica a janela de 30 dias, lista apagado/anonimizado/retido (fonte retention.ts) e mostra o campo de senha", () => {
    const html = renderToStaticMarkup(<DeleteAccountPanel state={base} />);
    expect(html).toContain("Excluir minha conta");
    expect(html).toContain("30 dias");
    for (const i of [DELETED_ITEMS[0], ANONYMIZED_ITEMS[0], RETAINED_ITEMS[0]]) expect(html).toContain(i.replace(/"/g, "&quot;"));
    expect(html).toContain('for="delete-account-password"');
    expect(html).toContain('type="password"');
  });
  it("bloqueios: mostra titulo + mensagem do servidor e NAO mostra o formulario de senha", () => {
    const html = renderToStaticMarkup(
      <DeleteAccountPanel
        state={{ ...base, canRequest: false, blockers: [
          { code: "active_subscription", message: "Cancele a assinatura primeiro.", orgName: "Acme" },
          { code: "last_owner_with_members", message: "Promova outro proprietario." },
          { code: "platform_admin", message: "Contate o suporte." },
          { code: "no_password", message: "Redefina a senha." },
        ] }}
      />,
    );
    expect(html).toContain("Ainda não é possível excluir sua conta");
    expect(html).toContain("Assinatura ativa");
    expect(html).toContain("Cancele a assinatura primeiro.");
    expect(html).toContain("Promova outro proprietario.");
    expect(html).toContain("Contate o suporte.");
    expect(html).toContain("Redefina a senha.");
    expect(html).not.toContain("delete-account-password");
  });
  it("awaiting_confirmation: 'Confira seu e-mail', cancelar pedido e reenviar", () => {
    const html = renderToStaticMarkup(<DeleteAccountPanel state={{ ...base, status: "awaiting_confirmation", confirmationExpiresAt: "2026-10-11T12:00:00.000Z" }} />);
    expect(html).toContain("Confira seu e-mail");
    expect(html).toContain("Cancelar pedido");
    expect(html).toContain("Reenviar e-mail de confirmação");
    expect(html).toContain('role="status"');
  });
  it("scheduled: 'Exclusão agendada para DD/MM/AAAA' e botão Cancelar exclusão; sem formulário", () => {
    const html = renderToStaticMarkup(<DeleteAccountPanel state={{ ...base, status: "scheduled", scheduledFor: "2026-11-09T12:00:00.000Z", canRequest: false }} />);
    expect(html).toContain("Exclusão agendada para 09/11/2026");
    expect(html).toContain("Cancelar exclusão");
    expect(html).not.toContain("delete-account-password");
  });
});

describe("DeletionTokenLanding (SSR)", () => {
  it("confirm: preview com botão explícito e validade", () => {
    const html = renderToStaticMarkup(<DeletionTokenLanding token="t" state={{ kind: "confirm", expiresAt: "2026-10-11T12:00:00.000Z", windowDays: 30 }} />);
    expect(html).toContain("Confirmar a exclusão da conta?");
    expect(html).toContain("30 dias");
    expect(html).toContain("Confirmar exclusão da conta");
  });
  it("cancel: mostra a data agendada e o botão Cancelar a exclusão", () => {
    const html = renderToStaticMarkup(<DeletionTokenLanding token="t" state={{ kind: "cancel", scheduledFor: "2026-11-09T12:00:00.000Z" }} />);
    expect(html).toContain("09/11/2026");
    expect(html).toContain("Cancelar a exclusão");
  });
  it("invalid e error: mensagens genéricas com alerta e link para o login", () => {
    const inv = renderToStaticMarkup(<DeletionTokenLanding token="t" state={{ kind: "invalid" }} />);
    expect(inv).toContain("Link inválido ou expirado");
    expect(inv).toContain('role="alert"');
    expect(inv).toContain('href="/login"');
    expect(renderToStaticMarkup(<DeletionTokenLanding token="t" state={{ kind: "error", message: "Muitas tentativas." }} />)).toContain("Muitas tentativas.");
  });
});

describe("loadDeletionLandingState", () => {
  beforeEach(() => preview.mockReset());
  it("token do tipo esperado vira confirm/cancel; tipo trocado ou inválido vira invalid (genérico)", async () => {
    preview.mockResolvedValueOnce({ ok: true, data: { valid: true, kind: "confirm", expiresAt: new Date("2026-10-11T00:00:00Z") } });
    expect((await loadDeletionLandingState("abc", "confirm")).state.kind).toBe("confirm");
    preview.mockResolvedValueOnce({ ok: true, data: { valid: true, kind: "cancel", scheduledFor: new Date("2026-11-09T00:00:00Z") } });
    expect((await loadDeletionLandingState("abc", "cancel")).state.kind).toBe("cancel");
    preview.mockResolvedValueOnce({ ok: true, data: { valid: true, kind: "cancel", scheduledFor: new Date() } });
    expect((await loadDeletionLandingState("abc", "confirm")).state.kind).toBe("invalid");
    preview.mockResolvedValueOnce({ ok: true, data: { valid: false } });
    expect((await loadDeletionLandingState("abc", "cancel")).state.kind).toBe("invalid");
  });
  it("rate limit vira erro com a mensagem do servidor; token é decodificado", async () => {
    preview.mockResolvedValueOnce({ ok: false, errors: { _form: ["Muitas tentativas."], code: ["rate_limited"] } });
    const r = await loadDeletionLandingState("a%20b", "confirm");
    expect(r.state).toEqual({ kind: "error", message: "Muitas tentativas." });
    expect(r.token).toBe("a b");
    expect(preview).toHaveBeenCalledWith({ token: "a b" });
  });
});

describe("LoginForm", () => {
  it("renderiza normalmente sem o aviso de exclusão (só aparece após account_deletion_pending)", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain("Entrar");
    expect(html).not.toContain("Cancelar exclusão");
  });
});
