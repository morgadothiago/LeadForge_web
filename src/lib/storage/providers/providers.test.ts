import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AzureBlobStorageProvider } from "./azure-blob";
import { LocalStorageProvider, signLocalRead, verifyLocalRead } from "./local";

let dir: string;
let p: LocalStorageProvider;
const SECRET = "s".repeat(40);
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lf-storage-"));
  p = new LocalStorageProvider(dir, SECRET);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("LocalStorageProvider", () => {
  it("put/exists/list/delete (idempotente)", async () => {
    const k = "orgs/a/creative/u1-x.txt";
    await p.put(k, Readable.from([Buffer.from("oi")]));
    expect(await p.exists(k)).toBe(true);
    expect(await readFile(path.join(dir, k), "utf8")).toBe("oi");
    expect((await p.list("orgs/a/")).map((o) => o.key)).toEqual([k]);
    expect(await p.list("orgs/b/")).toEqual([]);
    await p.delete(k);
    await p.delete(k);
    expect(await p.exists(k)).toBe(false);
  });

  it("path traversal na chave: put/delete/exists/getReadUrl lancam e nada e escrito fora da raiz", async () => {
    for (const k of ["../evil.txt", "orgs/a/../../evil.txt", "/etc/passwd", "orgs/a/..%2f/x"]) {
      await expect(p.put(k, Readable.from([Buffer.from("x")]))).rejects.toThrow();
      await expect(p.delete(k)).rejects.toThrow();
      await expect(p.exists(k)).rejects.toThrow();
      await expect(p.getReadUrl(k, { ttlSeconds: 60 })).rejects.toThrow();
    }
    await expect(readFile(path.join(dir, "..", "evil.txt"))).rejects.toThrow();
  });

  it("nao sobrescreve chave existente", async () => {
    const k = "orgs/a/creative/u2-x.txt";
    await p.put(k, Readable.from([Buffer.from("1")]));
    await expect(p.put(k, Readable.from([Buffer.from("2")]))).rejects.toThrow();
    expect(await readFile(path.join(dir, k), "utf8")).toBe("1");
  });

  it("URL assinada: valida, expira, nao aceita chave/exp adulterados, e somente leitura (sem upload URL)", async () => {
    const k = "orgs/a/creative/u3-x.txt";
    const url = new URL(await p.getReadUrl(k, { ttlSeconds: 60 }), "http://x");
    const key = url.searchParams.get("key")!;
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(verifyLocalRead(SECRET, key, exp, sig)).toBe(true);
    expect(verifyLocalRead(SECRET, key, exp, sig, (exp + 1) * 1000)).toBe(false); // expirada
    expect(verifyLocalRead(SECRET, "orgs/b/creative/u3-x.txt", exp, sig)).toBe(false); // outra chave
    expect(verifyLocalRead(SECRET, key, exp + 999, sig)).toBe(false);
    expect(verifyLocalRead("outro-segredo", key, exp, sig)).toBe(false);
    expect(verifyLocalRead(SECRET, key, exp, signLocalRead(SECRET, key, exp).slice(0, 10))).toBe(false);
    await expect(p.getUploadUrl()).rejects.toThrow();
  });
});

describe("AzureBlobStorageProvider (SAS offline, sem rede)", () => {
  const cs = `DefaultEndpointsProtocol=https;AccountName=devacct;AccountKey=${Buffer.from("k".repeat(32)).toString("base64")};EndpointSuffix=core.windows.net`;
  const az = new AzureBlobStorageProvider(cs, "leadforge-files");
  const key = "orgs/a/creative/u1-x.mp4";

  it("leitura: SAS somente `r` com expiracao curta", async () => {
    const u = new URL(await az.getReadUrl(key, { ttlSeconds: 120, fileName: "x.mp4" }));
    expect(u.pathname).toBe(`/leadforge-files/${key}`);
    expect(u.searchParams.get("sp")).toBe("r");
    const ttl = (Date.parse(u.searchParams.get("se")!) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(60);
    expect(ttl).toBeLessThanOrEqual(125);
  });

  it("escrita: SAS `cw` (sem leitura/delete/list)", async () => {
    const u = new URL(await az.getUploadUrl(key, { ttlSeconds: 120, contentType: "video/mp4" }));
    expect(u.searchParams.get("sp")).toBe("cw");
  });

  it("chave insegura e recusada antes de qualquer chamada de rede", async () => {
    await expect(az.getReadUrl("../x", { ttlSeconds: 60 })).rejects.toThrow();
    await expect(az.delete("orgs/a/../b/x")).rejects.toThrow();
  });
});
