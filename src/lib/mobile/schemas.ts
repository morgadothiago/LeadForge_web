import { z } from "zod";

export const mobileLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(80),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().trim().max(32).optional(),
});
export const mobileRefreshSchema = z.object({
  deviceId: z.string().uuid(),
  refreshToken: z.string().min(20).max(128),
});

const pushKinds = ["wa_disconnected", "wa_paused", "mass_opt_out", "handoff", "budget_alert", "budget_exhausted", "scheduler_stale", "lead_replied", "meeting_reminder"] as const;
export const pushTokenSchema = z.object({
  token: z.string().trim().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/).max(200).nullable(),
  prefs: z.object(Object.fromEntries(pushKinds.map((k) => [k, z.boolean().optional()]))).strict().optional(),
});

// SPEC-026
export const killSwitchSchema = z.object({ killSwitch: z.boolean(), password: z.string().min(1).max(256).optional() }).strict();
export const rejectDraftBodySchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
