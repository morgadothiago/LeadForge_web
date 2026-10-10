import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";

/** SPEC-050 (D-050-7). Espelha o enum Prisma `StoredFileCategory`. */
export const STORAGE_CATEGORIES = ["creative", "knowledge", "attachment"] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export function isStorageCategory(v: unknown): v is StorageCategory {
  return typeof v === "string" && (STORAGE_CATEGORIES as readonly string[]).includes(v);
}

const ORG_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NAME = 100;

/**
 * Nome de arquivo seguro: so o basename (descarta qualquer diretorio, `/` e `\`), sem acentos, apenas
 * `[A-Za-z0-9._-]`, sem `..`, sem ponto/hifen inicial, <= 100 chars (preserva a extensao).
 */
export function sanitizeFileName(raw: string): string {
  let name = String(raw ?? "").replace(/\0/g, "");
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  name = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-");
  name = name.replace(/^[.-]+/, "");
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name.length ? name : "arquivo";
}

export function orgPrefix(orgId: string): string {
  if (!ORG_ID_RE.test(orgId)) throw new AppError({ code: "validation", userMessage: "Organização inválida.", cause: new Error("orgId inválido para chave de storage") });
  return `orgs/${orgId}/`;
}

/** `orgs/{orgId}/{category}/{uuid}-{sanitizedFileName}`; `orgId` vem SEMPRE da sessao, nunca do cliente. */
export function buildBlobKey(orgId: string, category: StorageCategory, fileName: string, id: string = randomUUID()): string {
  if (!isStorageCategory(category)) throw new AppError({ code: "validation", userMessage: "Categoria inválida." });
  return `${orgPrefix(orgId)}${category}/${id}-${sanitizeFileName(fileName)}`;
}

/** Valida a FORMA da chave (sem traversal/segmentos vazios/barra invertida/NUL). Usado por todo provider. */
export function assertSafeKey(key: string): void {
  const ok =
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 400 &&
    !key.includes("\0") &&
    !key.includes("\\") &&
    !key.startsWith("/") &&
    key.split("/").every((seg) => SEGMENT_RE.test(seg) && !seg.includes(".."));
  if (!ok) throw new AppError({ code: "validation", userMessage: "Chave de arquivo inválida.", cause: new Error("chave de storage insegura") });
}

/** A chave pertence a org? (prefixo exato `orgs/{orgId}/`). */
export function keyBelongsToOrg(key: string, orgId: string): boolean {
  return key.startsWith(orgPrefix(orgId));
}

export function assertKeyInOrg(key: string, orgId: string): void {
  assertSafeKey(key);
  if (!keyBelongsToOrg(key, orgId)) throw new AppError({ code: "not_found", userMessage: "Arquivo não encontrado.", status: 404 });
}
