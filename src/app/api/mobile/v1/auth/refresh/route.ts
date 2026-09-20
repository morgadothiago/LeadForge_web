import { prisma } from "@/lib/prisma";
import { mobileRefreshSchema } from "@/lib/mobile/schemas";
import { ACCESS_TTL_SECONDS, hashRefresh, newRefreshToken, REFRESH_TTL_MS, signAccessToken } from "@/lib/mobile/token";
import { hitRefreshLimit } from "@/lib/mobile/refresh-limit";
import { fail, invalidInput, ok, readJson, tooMany } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const invalid = () => fail(401, "invalid_refresh", "Sessão inválida. Faça login novamente.");

/** SPEC-021: rotação do refresh. Reuso de refresh antigo revoga o dispositivo (suspeita de roubo). */
export async function POST(req: Request): Promise<Response> {
  const parsed = mobileRefreshSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { deviceId, refreshToken } = parsed.data;
  const wait = hitRefreshLimit(deviceId);
  if (wait > 0) return tooMany(wait);

  const hash = hashRefresh(refreshToken);
  const d = await prisma.mobileDevice.findUnique({ where: { id: deviceId }, select: { userId: true, refreshHash: true, prevRefreshHash: true, refreshExpiresAt: true, revokedAt: true } });
  if (!d || d.revokedAt) return invalid();
  if (d.prevRefreshHash === hash) {
    await prisma.mobileDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    return invalid();
  }
  if (d.refreshHash !== hash || d.refreshExpiresAt <= new Date()) return invalid();

  const next = newRefreshToken();
  // Rotação atômica: só uma requisição concorrente com o mesmo refresh vence.
  const upd = await prisma.mobileDevice.updateMany({
    where: { id: deviceId, refreshHash: hash, revokedAt: null },
    data: { refreshHash: next.hash, prevRefreshHash: hash, refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS), lastSeenAt: new Date() },
  });
  if (upd.count !== 1) return invalid();
  return ok({ accessToken: await signAccessToken(d.userId, deviceId), refreshToken: next.token, expiresIn: ACCESS_TTL_SECONDS, deviceId });
}
