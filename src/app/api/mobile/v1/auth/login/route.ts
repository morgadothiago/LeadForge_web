import { prisma } from "@/lib/prisma";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { getClientIp } from "@/lib/auth/client-ip";
import { emailKey, isRateLimited, loginKey, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { mobileLoginSchema } from "@/lib/mobile/schemas";
import { ACCESS_TTL_SECONDS, newRefreshToken, REFRESH_TTL_MS, signAccessToken } from "@/lib/mobile/token";
import { invalidCredentials, invalidInput, ok, readJson, tooMany } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** SPEC-021: login mobile. Público (sem Bearer). Erro genérico; rate limit compartilhado com o login web. */
export async function POST(req: Request): Promise<Response> {
  const parsed = mobileLoginSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { email, password, deviceName, platform, appVersion } = parsed.data;
  const key = loginKey(email, getClientIp(req.headers));
  const ek = emailKey(email);
  if (isRateLimited(key, ek)) return tooMany(60);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, passwordHash: true } });
  const good = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !user.passwordHash || !good) {
    recordFailure(key, ek);
    return invalidCredentials();
  }
  resetFailures(key, ek);

  const refresh = newRefreshToken();
  const device = await prisma.mobileDevice.create({
    data: { userId: user.id, name: deviceName, platform, appVersion, refreshHash: refresh.hash, refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    select: { id: true },
  });
  return ok({
    accessToken: await signAccessToken(user.id, device.id),
    refreshToken: refresh.token,
    expiresIn: ACCESS_TTL_SECONDS,
    deviceId: device.id,
    user: { id: user.id, name: user.name, role: user.role },
  });
}
