import type { AxiosInstance } from "axios";
import { prisma } from "@/lib/prisma";
import { createHttpClient } from "@/lib/http/client";
import { safeErrorForLog } from "@/lib/errors";
import { redactText } from "./sanitize";

/**
 * SPEC-023: envio opcional via Expo Push (D-M4). Desligado por padrao (MOBILE_PUSH_ENABLED=true liga).
 * Payload generico: titulo do tipo + corpo fixo; `data` leva apenas alertId. Nunca PII. Token nunca vai para log.
 */
export const pushEnabled = () => process.env.MOBILE_PUSH_ENABLED === "true";

let client: AxiosInstance | undefined;
function getClient(): AxiosInstance {
  return (client ??= createHttpClient({
    name: "Expo Push",
    baseURL: "https://exp.host/--/api/v2",
    timeout: 10_000,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    retry: { maxAttempts: 3 },
  }));
}
/** Somente testes: injeta cliente com adapter falso. */
export function _setExpoClient(c: AxiosInstance | undefined): void {
  client = c;
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
export const isExpoToken = (t: string) => EXPO_TOKEN.test(t);

export interface PushAlert { id: string; kind: string; title: string; body: string }

/** Kinds com push ligado por padrao; lead_replied e opt-in por dispositivo. */
export function prefAllows(prefs: unknown, kind: string): boolean {
  const v = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, unknown>)[kind] : undefined;
  if (typeof v === "boolean") return v;
  return kind !== "lead_replied";
}

/** Envia o push de um alerta a todos os dispositivos ativos com token e preferencia ligada. Nunca lanca. */
export async function sendPushForAlert(alert: PushAlert): Promise<{ sent: number; removed: number }> {
  if (!pushEnabled()) return { sent: 0, removed: 0 };
  try {
    const devices = await prisma.mobileDevice.findMany({
      where: { revokedAt: null, pushToken: { not: null } },
      select: { id: true, pushToken: true, pushPrefs: true },
    });
    const targets = devices.filter((d) => d.pushToken && prefAllows(d.pushPrefs, alert.kind));
    if (!targets.length) return { sent: 0, removed: 0 };
    const messages = targets.map((d) => ({ to: d.pushToken as string, title: alert.title, body: alert.body, sound: "default", data: { alertId: alert.id } }));
    const res = await getClient().post("/push/send", messages, { idempotent: true });
    const tickets: unknown[] = Array.isArray(res.data?.data) ? res.data.data : [];
    let removed = 0;
    let sent = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = tickets[i] as { status?: string; details?: { error?: string } } | undefined;
      if (t?.status === "ok") sent++;
      else if (t?.details?.error === "DeviceNotRegistered") {
        await prisma.mobileDevice.updateMany({ where: { id: targets[i].id, pushToken: targets[i].pushToken }, data: { pushToken: null } });
        removed++;
      }
    }
    return { sent, removed };
  } catch (e) {
    console.warn("[mobile-push] falha ao enviar:", redactText(safeErrorForLog(e)));
    return { sent: 0, removed: 0 };
  }
}
