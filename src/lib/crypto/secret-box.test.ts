import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./secret-box";
import { getEncryptionKey } from "@/lib/env";

const key = randomBytes(32);

describe("secret-box AES-256-GCM", () => {
  it("round-trip com payload versionado", () => {
    const p = encrypt("s3nh@ çã", key);
    expect(p.startsWith("v1:")).toBe(true);
    expect(p.split(":")).toHaveLength(4);
    expect(p).not.toContain("s3nh@");
    expect(decrypt(p, key)).toBe("s3nh@ çã");
  });
  it("IV diferente a cada cifra", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });
  it("adulteração falha", () => {
    const [v, iv, tag, data] = encrypt("segredo", key).split(":");
    const buf = Buffer.from(data, "base64");
    buf[0] ^= 1;
    expect(() => decrypt([v, iv, tag, buf.toString("base64")].join(":"), key)).toThrow();
    const t = Buffer.from(tag, "base64");
    t[0] ^= 1;
    expect(() => decrypt([v, iv, t.toString("base64"), data].join(":"), key)).toThrow();
  });
  it("chave errada e formato inválido falham", () => {
    expect(() => decrypt(encrypt("a", key), randomBytes(32))).toThrow();
    expect(() => decrypt("v2:a:b:c", key)).toThrow();
    expect(() => decrypt("lixo", key)).toThrow();
  });
  it("getEncryptionKey valida ausência e tamanho", () => {
    expect(() => getEncryptionKey({})).toThrow(/ENCRYPTION_KEY não configurada/);
    expect(() => getEncryptionKey({ ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(getEncryptionKey({ ENCRYPTION_KEY: key.toString("base64") })).toHaveLength(32);
  });
});
