import { getStorageConfig } from "./config";
import { AzureBlobStorageProvider } from "./providers/azure-blob";
import { LocalStorageProvider } from "./providers/local";
import type { StorageProvider } from "./provider";

/**
 * SPEC-050 — unico ponto que escolhe o `StorageProvider` ativo por env. Sem cache (le env a cada chamada;
 * clients Azure sao baratos e o container e garantido 1x por instancia de provider).
 */
const azureCache = new Map<string, AzureBlobStorageProvider>();

export function getStorageProvider(env: Record<string, string | undefined> = process.env): StorageProvider {
  const cfg = getStorageConfig(env);
  if (cfg.provider === "local") return new LocalStorageProvider(cfg.localDir, env.AUTH_SECRET ?? "");
  const cacheKey = `${cfg.container}|${cfg.connectionString}`;
  let p = azureCache.get(cacheKey);
  if (!p) azureCache.set(cacheKey, (p = new AzureBlobStorageProvider(cfg.connectionString!, cfg.container)));
  return p;
}
