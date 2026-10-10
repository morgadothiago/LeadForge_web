import { describe, expect, it } from "vitest";
import { assertKeyInOrg, assertSafeKey, buildBlobKey, keyBelongsToOrg, sanitizeFileName } from "./keys";
import { matchesMagic } from "./magic";
import { getStorageConfig } from "./config";

describe("sanitizeFileName / chave (path traversal, SPEC-050)", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\x.png", "x.png"],
    ["/abs/path/foto.png", "foto.png"],
    ["....//a.png", "a.png"],
    ["foto bonita ção.PNG", "foto-bonita-cao.PNG"],
    ["", "arquivo"],
    ["..", "arquivo"],
    ["a\0b.png", "ab.png"],
  ])("%j -> %j", (input, out) => {
    expect(sanitizeFileName(input)).toBe(out);
  });

  it("nome longo preserva extensao e limita tamanho", () => {
    const n = sanitizeFileName("a".repeat(300) + ".mp4");
    expect(n.length).toBeLessThanOrEqual(100);
    expect(n.endsWith(".mp4")).toBe(true);
  });

  it("buildBlobKey: orgs/{org}/{cat}/{uuid}-{nome}, nunca escapa do prefixo", () => {
    const k = buildBlobKey("org-1", "creative", "../../../x.png", "11111111-1111-1111-1111-111111111111");
    expect(k).toBe("orgs/org-1/creative/11111111-1111-1111-1111-111111111111-x.png");
    expect(() => assertSafeKey(k)).not.toThrow();
    expect(keyBelongsToOrg(k, "org-1")).toBe(true);
    expect(keyBelongsToOrg(k, "org-2")).toBe(false);
    expect(keyBelongsToOrg(k, "org")).toBe(false); // prefixo parcial de id nao vale
  });

  it("orgId malicioso e categoria invalida sao recusados", () => {
    expect(() => buildBlobKey("../org", "creative", "a.png")).toThrow();
    expect(() => buildBlobKey("a/b", "creative", "a.png")).toThrow();
    // @ts-expect-error categoria fora do enum
    expect(() => buildBlobKey("org-1", "../x", "a.png")).toThrow();
  });

  it.each(["../x", "orgs/a/../b/c", "/orgs/a/x", "orgs//a/x", "orgs\\a\\x", "orgs/a/x\0", "", "orgs/a/.hidden"])("assertSafeKey recusa %j", (k) => {
    expect(() => assertSafeKey(k)).toThrow();
  });

  it("assertKeyInOrg: chave de outra org => not_found", () => {
    expect(() => assertKeyInOrg("orgs/b/creative/x-a.png", "a")).toThrow(/não encontrado/i);
  });
});

describe("magic bytes", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it("png ok; png declarado mas conteudo exe => recusa", () => {
    expect(matchesMagic("image/png", png)).toBe(true);
    expect(matchesMagic("image/png", Buffer.from("MZ\x90\x00 executable"))).toBe(false);
    expect(matchesMagic("image/jpeg", png)).toBe(false);
  });
  it("text/* sem NUL ok, com NUL recusa; tipo sem assinatura recusa", () => {
    expect(matchesMagic("text/plain", Buffer.from("ola"))).toBe(true);
    expect(matchesMagic("text/plain", Buffer.from([0x61, 0, 0x62]))).toBe(false);
    expect(matchesMagic("application/zip", Buffer.from("PK\x03\x04"))).toBe(false);
    expect(matchesMagic("text/plain", Buffer.alloc(0))).toBe(false);
  });
});

describe("getStorageConfig", () => {
  it("sem env Azure => local; com connection string => azure", () => {
    expect(getStorageConfig({}).provider).toBe("local");
    expect(getStorageConfig({ AZURE_STORAGE_CONNECTION_STRING: "x" }).provider).toBe("azure");
  });
  it("azure sem connection string, provider invalido, limite invalido => erro tipado config", () => {
    expect(() => getStorageConfig({ STORAGE_PROVIDER: "azure" })).toThrow(/indispon/i);
    expect(() => getStorageConfig({ STORAGE_PROVIDER: "s3" })).toThrow(/indispon/i);
    expect(() => getStorageConfig({ STORAGE_MAX_FILE_BYTES: "abc" })).toThrow(/indispon/i);
  });
  it("producao sem Azure e sem opt-in local => indisponivel (nao quebra o app, so a feature)", () => {
    expect(() => getStorageConfig({ NODE_ENV: "production" })).toThrow(/indispon/i);
    expect(getStorageConfig({ NODE_ENV: "production", STORAGE_PROVIDER: "local" }).provider).toBe("local");
  });
  it("limite e allowlist configuraveis por env", () => {
    const c = getStorageConfig({ STORAGE_MAX_FILE_BYTES: "100", STORAGE_ALLOWED_MIME: "image/png, Video/MP4" });
    expect(c.maxFileBytes).toBe(100);
    expect(c.allowedMime).toEqual(["image/png", "video/mp4"]);
  });
  it("mensagem ao usuario nunca carrega a connection string", () => {
    try {
      getStorageConfig({ STORAGE_PROVIDER: "azure" });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/AccountKey/);
    }
  });
});
