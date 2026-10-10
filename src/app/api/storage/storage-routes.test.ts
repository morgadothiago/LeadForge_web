import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";

const session = vi.hoisted(() => ({ current: null as null | { orgId: string; userId: string } }));
vi.mock("@/lib/auth/require-admin", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/require-admin")>();
  const guard = async () => {
    if (!session.current) throw new UnauthorizedError();
    return { user: { id: session.current.userId } as never, orgId: session.current.orgId };
  };
  return { ...real, requireProviderOrg: guard, requireActiveProviderOrg: guard };
});

import { GET as list, POST as upload } from "./files/route";
import { DELETE as del } from "./files/[id]/route";
import { GET as url } from "./files/[id]/url/route";
import { GET as serveLocal } from "./local/route";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
let dir: string;
let a: TestOrg;
let b: TestOrg;
const env = { ...process.env };
const as = (o: TestOrg | null) => { session.current = o && { orgId: o.orgId, userId: o.userId }; };
const post = (q: string, body: Buffer, type = "image/png") =>
  upload(new Request(`http://x/api/storage/files?${q}`, { method: "POST", body: new Uint8Array(body), headers: { "content-type": type }, duplex: "half" } as RequestInit));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lf-storage-rt-"));
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  a = await createTestOrg("stor-rt-a");
  b = await createTestOrg("stor-rt-b");
});
afterAll(async () => {
  process.env = env;
  await purgeTestOrg(a);
  await purgeTestOrg(b);
  await rm(dir, { recursive: true, force: true });
});

describe("/api/storage/*", () => {
  it("sem sessao => 401 JSON", async () => {
    as(null);
    expect((await list(new Request("http://x/api/storage/files"))).status).toBe(401);
    expect((await post("category=creative&name=a.png", PNG)).status).toBe(401);
  });

  it("fluxo da org A: upload (stream), lista, URL assinada, leitura pela rota local, delete", async () => {
    as(a);
    const r = await post("category=creative&name=foto.png", PNG);
    expect(r.status).toBe(201);
    const { data } = await r.json();
    expect(JSON.stringify(data)).not.toContain("blobKey");
    const l = await (await list(new Request("http://x/api/storage/files?category=creative"))).json();
    expect(l.data.map((i: { id: string }) => i.id)).toContain(data.id);
    const u = await (await url(new Request("http://x"), { params: Promise.resolve({ id: data.id }) })).json();
    const served = await serveLocal(new Request(`http://x${u.data.url}`));
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
    const tampered = await serveLocal(new Request(`http://x${u.data.url.replace(/sig=[0-9a-f]{4}/, "sig=ffff")}`));
    expect(tampered.status).toBe(403);
    expect((await del(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: data.id }) })).status).toBe(200);
    expect((await serveLocal(new Request(`http://x${u.data.url}`))).status).toBe(404);
  });

  it("org B recebe 404 ao ler/remover arquivo da org A e nao o ve na lista", async () => {
    as(a);
    const { data } = await (await post("category=attachment&name=x.png", PNG)).json();
    as(b);
    expect((await url(new Request("http://x"), { params: Promise.resolve({ id: data.id }) })).status).toBe(404);
    expect((await del(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: data.id }) })).status).toBe(404);
    const l = await (await list(new Request("http://x/api/storage/files"))).json();
    expect(l.data).toEqual([]);
  });

  it("erros de validacao: MIME 415, categoria 400, Content-Length acima do limite 413, Origin externo 403", async () => {
    as(a);
    expect((await post("category=creative&name=a.exe", PNG, "application/x-msdownload")).status).toBe(415);
    expect((await post("category=zzz&name=a.png", PNG)).status).toBe(400);
    process.env.STORAGE_MAX_FILE_BYTES = "10";
    expect((await post("category=creative&name=a.png", PNG)).status).toBe(413);
    delete process.env.STORAGE_MAX_FILE_BYTES;
    const evil = await upload(new Request("http://x/api/storage/files?category=creative&name=a.png", { method: "POST", body: new Uint8Array(PNG), headers: { "content-type": "image/png", origin: "http://evil.test", host: "x" } }));
    expect(evil.status).toBe(403);
  });

  it("rota local so aceita chave valida e assinatura (traversal => 4xx)", async () => {
    as(a);
    const r = await serveLocal(new Request("http://x/api/storage/local?key=../../etc/passwd&exp=9999999999&sig=a"));
    expect([400, 403]).toContain(r.status);
  });
});
