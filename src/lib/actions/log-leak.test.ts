import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { handleActionError } from "./result";

const rawAxiosError = () =>
  Object.assign(new Error("Request failed with status code 500"), {
    name: "AxiosError",
    code: "ERR_BAD_RESPONSE",
    config: { url: "http://evo/x", headers: { apikey: "SEGREDO-XYZ", Authorization: "Bearer SEGREDO-ABC" } },
    request: { _header: "apikey: SEGREDO-XYZ" },
    response: { status: 500, data: { token: "SEGREDO-XYZ" }, headers: { authorization: "Bearer SEGREDO-ABC" } },
  });

afterEach(() => vi.restoreAllMocks());

function captured(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c: unknown[]) => c.map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x, Object.getOwnPropertyNames(Object(x))) + String(x))).join(" ")).join("\n");
}

describe("log não vaza segredos", () => {
  it("AppError com cause AxiosError cru: PT-BR em _form e sem segredo no console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = handleActionError(new AppError({ code: "upstream", userMessage: "O serviço falhou. Tente novamente.", status: 500, cause: rawAxiosError() }));
    expect(r).toEqual({ ok: false, errors: { _form: ["O serviço falhou. Tente novamente."] } });
    expect(spy).toHaveBeenCalled();
    const out = captured(spy);
    expect(out).not.toMatch(/SEGREDO-XYZ|SEGREDO-ABC|apikey|Authorization|Bearer/i);
  });

  it("AxiosError cru direto (erro inesperado): mensagem genérica PT-BR e sem segredo", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = handleActionError(rawAxiosError());
    expect(r).toEqual({ ok: false, errors: { _form: ["Não foi possível concluir a operação. Tente novamente."] } });
    expect(captured(spy)).not.toMatch(/SEGREDO-XYZ|SEGREDO-ABC|apikey|Authorization|Bearer/i);
  });
});
