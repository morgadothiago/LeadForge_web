import { ok } from "@/lib/mobile/http";
import { deleteFile } from "@/lib/storage/service";
import { withStorageAuth } from "@/lib/storage/http";

export const dynamic = "force-dynamic";

/** SPEC-050: soft delete + remocao do blob. Arquivo de outra org => 404. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withStorageAuth(req, "write", async ({ orgId }) => {
    await deleteFile(orgId, id);
    return ok({ deleted: true });
  });
}
