import { AppError } from "@/lib/errors";

/**
 * SPEC-050 — configuracao de storage lida de env a cada chamada (sem cache, testavel). Tudo opcional:
 * sem env Azure o provider e `local` (D-050-3) e, em producao, a feature falha com erro tipado claro
 * (`code: "config"`) em vez de quebrar o app.
 */
export type StorageProviderName = "azure" | "local";

export interface StorageConfig {
  provider: StorageProviderName;
  connectionString?: string;
  container: string;
  localDir: string;
  maxFileBytes: number;
  allowedMime: string[];
}

export const DEFAULT_CONTAINER = "leadforge-files";
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_ALLOWED_MIME = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/webm",
  "application/pdf", "text/plain", "text/markdown", "text/csv",
];

function unavailable(reason: string): AppError {
  return new AppError({ code: "config", userMessage: "Armazenamento de arquivos indisponível no momento.", cause: new Error(reason) });
}

export function getStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING?.trim() || undefined;
  const explicit = env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== "azure" && explicit !== "local") throw unavailable(`STORAGE_PROVIDER inválido: ${explicit}`);
  const provider: StorageProviderName = (explicit as StorageProviderName | undefined) ?? (connectionString ? "azure" : "local");
  if (provider === "azure" && !connectionString) throw unavailable("STORAGE_PROVIDER=azure sem AZURE_STORAGE_CONNECTION_STRING.");
  // `local` grava em disco: efemero/somente-leitura em serverless. Em producao so com opt-in explicito.
  if (provider === "local" && env.NODE_ENV === "production" && explicit !== "local") {
    throw unavailable("Storage não configurado em produção (defina AZURE_STORAGE_CONNECTION_STRING ou STORAGE_PROVIDER=local).");
  }

  const rawMax = env.STORAGE_MAX_FILE_BYTES?.trim();
  const maxFileBytes = rawMax ? Number(rawMax) : DEFAULT_MAX_FILE_BYTES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes <= 0) throw unavailable("STORAGE_MAX_FILE_BYTES inválido.");

  const allowedMime = env.STORAGE_ALLOWED_MIME?.trim()
    ? env.STORAGE_ALLOWED_MIME.split(",").map((m) => m.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_MIME;

  return {
    provider,
    connectionString,
    container: env.AZURE_STORAGE_CONTAINER?.trim() || DEFAULT_CONTAINER,
    localDir: env.STORAGE_LOCAL_DIR?.trim() || ".storage",
    maxFileBytes,
    allowedMime,
  };
}
