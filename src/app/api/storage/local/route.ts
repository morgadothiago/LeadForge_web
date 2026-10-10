import { Readable } from "node:stream";
import { fail } from "@/lib/mobile/http";
import { getStorageConfig } from "@/lib/storage/config";
import { assertSafeKey } from "@/lib/storage/keys";
import { LocalStorageProvider, verifyLocalRead } from "@/lib/storage/providers/local";
import { prisma } from "@/lib/prisma";
import { storageErrorResponse } from "@/lib/storage/http";

export const dynamic = "force-dynamic";

/**
 * SPEC-050 (D-050-3): serve arquivos do provider `local` mediante URL assinada (HMAC key+exp, somente leitura).
 * So existe com provider `local`; com Azure responde 404. Exige tambem a sessao (proxy.ts) — a assinatura e a
 * autorizacao por arquivo/org.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const cfg = getStorageConfig();
    if (cfg.provider !== "local") return fail(404, "not_found", "Não encontrado.");
    const q = new URL(req.url).searchParams;
    const key = q.get("key") ?? "";
    const exp = Number(q.get("exp"));
    const sig = q.get("sig") ?? "";
    assertSafeKey(key);
    if (!verifyLocalRead(process.env.AUTH_SECRET ?? "", key, exp, sig)) return fail(403, "forbidden", "Link inválido ou expirado.");
    const meta = await prisma.storedFile.findUnique({ where: { blobKey: key }, select: { mimeType: true, deletedAt: true } });
    if (!meta || meta.deletedAt) return fail(404, "not_found", "Arquivo não encontrado.");
    const provider = new LocalStorageProvider(cfg.localDir, process.env.AUTH_SECRET ?? "");
    if (!(await provider.exists(key))) return fail(404, "not_found", "Arquivo não encontrado.");
    const { stream, sizeBytes } = provider.openRead(key);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { "Content-Type": meta.mimeType, "Content-Length": String(await sizeBytes), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" },
    });
  } catch (e) {
    return storageErrorResponse(e);
  }
}
