import { Readable } from "node:stream";
import { fail, ok } from "@/lib/mobile/http";
import { listFiles, uploadFile } from "@/lib/storage/service";
import { withStorageAuth } from "@/lib/storage/http";

export const dynamic = "force-dynamic";

/** SPEC-050: lista paginada por cursor (`?category=&cursor=&limit=`), escopada pela org da sessao. */
export async function GET(req: Request): Promise<Response> {
  return withStorageAuth(req, "read", async ({ orgId }) => {
    const q = new URL(req.url).searchParams;
    const rawLimit = q.get("limit");
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) return fail(400, "invalid_input", "limit inválido.");
    const data = await listFiles(orgId, { category: q.get("category") ?? undefined, cursor: q.get("cursor"), limit: rawLimit ? Number(rawLimit) : undefined });
    return ok(data.items, { nextCursor: data.nextCursor });
  });
}

/**
 * SPEC-050 (D-050-4): upload via servidor com STREAM. Corpo = bytes crus do arquivo; `Content-Type` = MIME;
 * `?category=creative|knowledge|attachment&name=arquivo.ext`. orgId/userId vem da sessao.
 */
export async function POST(req: Request): Promise<Response> {
  return withStorageAuth(req, "write", async ({ orgId, userId }) => {
    const q = new URL(req.url).searchParams;
    if (!req.body) return fail(400, "invalid_input", "Corpo vazio.");
    const len = req.headers.get("content-length");
    const file = await uploadFile(
      { orgId, userId },
      {
        category: q.get("category") ?? "",
        fileName: q.get("name") ?? "",
        contentType: req.headers.get("content-type") ?? "",
        declaredSize: len && /^\d+$/.test(len) ? Number(len) : null,
        body: Readable.fromWeb(req.body as import("node:stream/web").ReadableStream<Uint8Array>),
      },
    );
    return ok(file, undefined, 201);
  });
}
