import { describe, expect, it } from "vitest";
import { AppError, type AppErrorCode } from "@/lib/errors";
import { isBillingUnavailableError } from "./provider-errors";

const e = (code: AppErrorCode, status?: number) => new AppError({ code, userMessage: "x", status });

describe("isBillingUnavailableError (SPEC-063, D-063-24)", () => {
  it("upstream/network/timeout/config: sempre indisponivel", () => {
    for (const c of ["upstream", "network", "timeout", "config"] as const) expect(isBillingUnavailableError(e(c)), c).toBe(true);
  });
  it("validation/unauthorized/forbidden/not_found/conflict: so quando vieram de resposta HTTP do provedor (status)", () => {
    for (const [c, s] of [["validation", 422], ["validation", 400], ["unauthorized", 401], ["forbidden", 403], ["not_found", 404], ["conflict", 409]] as const) {
      expect(isBillingUnavailableError(e(c, s)), `${c}/${s}`).toBe(true);
      expect(isBillingUnavailableError(e(c)), `${c} local`).toBe(false);
    }
  });
  it("rate_limited, erros nao-AppError e unknown seguem como hoje", () => {
    expect(isBillingUnavailableError(e("rate_limited", 429))).toBe(false);
    expect(isBillingUnavailableError(new Error("x"))).toBe(false);
    expect(isBillingUnavailableError(e("unknown", 418))).toBe(false);
  });
});
