import { getCreativeConfig } from "./config";
import { MockAvatarVideoProvider } from "./providers/mock";
import type { AvatarVideoProvider } from "./provider";

/** SPEC-051 — unico ponto que escolhe o provedor ativo (`CREATIVE_PROVIDER`). Hoje so `mock` (Q-051-1 sem decisao). */
let mockSingleton: MockAvatarVideoProvider | undefined;

export function getAvatarVideoProvider(env: Record<string, string | undefined> = process.env): AvatarVideoProvider {
  const cfg = getCreativeConfig(env);
  // Futuro: `case "heygen": return new HeyGenProvider(env.HEYGEN_API_KEY ...)`. Nunca chamar provedor real nos testes.
  return (mockSingleton ??= new MockAvatarVideoProvider({ delayMs: cfg.mockDelayMs })).withDelay(cfg.mockDelayMs);
}

/** APENAS testes. */
export function _resetCreativeProviderForTests(): void {
  mockSingleton = undefined;
}
