import { describe, expect, it, vi } from "vitest";
import { DriverAdapterError } from "@prisma/driver-adapter-utils";
import { Prisma } from "@prisma/client";
import { isRetryableTxConflict, withSerializableRetry } from "./tx-conflict";

const adapterConflict = () => new DriverAdapterError({ kind: "TransactionWriteConflict" });

describe("isRetryableTxConflict", () => {
  it("reconhece DriverAdapterError real (TransactionWriteConflict)", () => {
    const e = adapterConflict();
    expect(e.name).toBe("DriverAdapterError");
    expect(isRetryableTxConflict(e)).toBe(true);
  });
  it("reconhece P2034", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2034", clientVersion: "7" });
    expect(isRetryableTxConflict(e)).toBe(true);
  });
  it("reconhece SQLSTATE 40001/40P01 (direto, em cause e em meta)", () => {
    expect(isRetryableTxConflict({ code: "40001" })).toBe(true);
    expect(isRetryableTxConflict({ code: "40P01" })).toBe(true);
    expect(isRetryableTxConflict(new Error("x", { cause: { code: "40001" } }))).toBe(true);
    expect(isRetryableTxConflict({ meta: { code: "40P01" } })).toBe(true);
  });
  it("não reconhece outros erros", () => {
    expect(isRetryableTxConflict(new Error("TransactionWriteConflict?"))).toBe(false);
    expect(isRetryableTxConflict(new DriverAdapterError({ kind: "UniqueConstraintViolation", constraint: { fields: ["a"] } }))).toBe(false);
    expect(isRetryableTxConflict(new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "7" }))).toBe(false);
    expect(isRetryableTxConflict(null)).toBe(false);
    expect(isRetryableTxConflict("40001")).toBe(false);
  });
});

describe("withSerializableRetry", () => {
  const sleep = vi.fn(async () => undefined);
  it("repete até sucesso", async () => {
    let n = 0;
    const r = await withSerializableRetry(async () => { if (++n < 3) throw adapterConflict(); return "ok"; }, { sleep });
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("esgota tentativas e relança o conflito", async () => {
    let n = 0;
    await expect(withSerializableRetry(async () => { n++; throw adapterConflict(); }, { attempts: 3, sleep })).rejects.toSatisfy(isRetryableTxConflict);
    expect(n).toBe(3);
  });
  it("não repete erro não retentável", async () => {
    let n = 0;
    await expect(withSerializableRetry(async () => { n++; throw new Error("boom"); }, { sleep })).rejects.toThrow("boom");
    expect(n).toBe(1);
  });
});
