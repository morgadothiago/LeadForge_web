import { prisma } from "@/lib/prisma";
import { invalidInput, ok, readJson, requireMobile } from "@/lib/mobile/http";
import { pushTokenSchema } from "@/lib/mobile/schemas";

export const dynamic = "force-dynamic";

/** Registra/atualiza (ou remove, com token null) o push token do PROPRIO dispositivo autenticado. Nunca ecoa o token. */
export async function PUT(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const p = pushTokenSchema.safeParse(await readJson(req));
  if (!p.success) return invalidInput();
  const { token, prefs } = p.data;
  if (token) await prisma.mobileDevice.updateMany({ where: { pushToken: token, id: { not: a.deviceId } }, data: { pushToken: null } });
  await prisma.mobileDevice.update({ where: { id: a.deviceId }, data: { pushToken: token, ...(prefs ? { pushPrefs: prefs } : {}) } });
  return ok({ registered: token !== null });
}

export async function DELETE(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  await prisma.mobileDevice.update({ where: { id: a.deviceId }, data: { pushToken: null } });
  return ok({ registered: false });
}
