import type { Readable } from "node:stream";

/**
 * SPEC-050 — abstracao de storage de arquivos (mesmo padrao de `PaymentProvider`/`EmailProvider`).
 * Chamadores NUNCA importam `providers/*` direto: sempre `getStorageProvider()` (`factory.ts`).
 * As chaves ja chegam validadas/escopadas por org (`keys.ts`); cada provider ainda revalida a chave
 * (defesa em profundidade contra path traversal).
 */
export interface StorageObjectInfo {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

export interface SignedUrlOptions {
  /** TTL em segundos (curto; o service limita a MAX_SIGNED_URL_TTL_SECONDS). */
  ttlSeconds: number;
  /** Nome sugerido para download (Content-Disposition). */
  fileName?: string;
}

export interface StorageProvider {
  readonly name: "azure" | "local";
  /** Grava o stream na chave (sobrescrita nao e esperada: a chave contem um uuid). */
  put(key: string, body: Readable, opts: { contentType: string }): Promise<void>;
  /** Idempotente: remover chave inexistente nao falha. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** URL temporaria SOMENTE-LEITURA (SAS `r` no Azure; URL assinada HMAC no local). */
  getReadUrl(key: string, opts: SignedUrlOptions): Promise<string>;
  /** URL temporaria de ESCRITA (SAS `cw`) para upload direto do browser. Sem UI nesta SPEC (D-050-4). */
  getUploadUrl(key: string, opts: SignedUrlOptions & { contentType: string }): Promise<string>;
  /** Lista objetos por prefixo (reconciliacao/purga; a listagem de produto vem do banco). */
  list(prefix: string): Promise<StorageObjectInfo[]>;
}

export const MAX_SIGNED_URL_TTL_SECONDS = 900;
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
