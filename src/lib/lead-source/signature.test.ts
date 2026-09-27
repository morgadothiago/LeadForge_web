import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "./signature";

const SECRET = "app-secret-de-teste-0123456789";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifyMetaSignature (X-Hub-Signature-256)", () => {
  it("aceita assinatura correta", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejeita header ausente, malformado, com App Secret errado, ou corpo alterado depois de assinado", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "not-a-signature", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "outro-secret-qualquer-32chars!!"), SECRET)).toBe(false);
    expect(verifyMetaSignature(body + "x", sign(body), SECRET)).toBe(false);
  });
});
