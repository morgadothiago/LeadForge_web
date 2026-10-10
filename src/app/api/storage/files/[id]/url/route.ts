import { ok } from "@/lib/mobile/http";
import { getFileUrl } from "@/lib/storage/service";
import { withStorageAuth } from "@/lib/storage/http";

export const dynamic = "force-dynamic";

/** SPEC-050: URL de leitura assinada (SAS curta) gerada apos checar a org da sessao. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withStorageAuth(req, "read", async ({ orgId }) => ok(await getFileUrl(orgId, id)));
}
