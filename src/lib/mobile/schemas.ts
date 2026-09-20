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
