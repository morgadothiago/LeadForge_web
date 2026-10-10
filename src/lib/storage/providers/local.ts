import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { AppError } from "@/lib/errors";
import { assertSafeKey } from "../keys";
import type { SignedUrlOptions, StorageObjectInfo, StorageProvider } from "../provider";

/**
 * SPEC-050 (D-050-3) — provider `local`: filesystem em diretorio ignorado pelo git (`.storage/` por padrao),
 * para dev/teste. "URL de leitura" = rota `/api/storage/local` com assinatura HMAC (key + expiracao), somente
 * leitura. Nao existe URL de upload direto (D-050-4: sem UI de SAS-upload).
 */
export const LOCAL_READ_ROUTE = "/api/storage/local";

export function signLocalRead(secret: string, key: string, exp: number): string {
  return createHmac("sha256", secret).update(`r\n${key}\n${exp}`).digest("hex");
}

export function verifyLocalRead(secret: string, key: string, exp: number, sig: string, now = Date.now()): boolean {
  if (!secret || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(signLocalRead(secret, key, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(dir: string, private readonly secret: string) {
    this.root = path.resolve(dir);
  }

  /** Resolve a chave para um caminho DENTRO da raiz; qualquer escape lanca. */
  private resolveKey(key: string): string {
    assertSafeKey(key);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new AppError({ code: "validation", userMessage: "Chave de arquivo inválida." });
    return target;
  }

  async put(key: string, body: Readable): Promise<void> {
    const file = this.resolveKey(key);
    await mkdir(path.dirname(file), { recursive: true });
    // `wx`: nunca sobrescreve. Se a chave ja existe, falha SEM remover o arquivo existente.
    if (await this.exists(key)) throw new AppError({ code: "conflict", userMessage: "Arquivo já existe.", status: 409 });
    try {
      await pipeline(body, createWriteStream(file, { flags: "wx" }));
    } catch (e) {
      await rm(file, { force: true });
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.resolveKey(key)).then((s) => s.isFile(), () => false);
  }

  /** Stream de leitura (usado pela rota `/api/storage/local`). */
  openRead(key: string): { stream: Readable; sizeBytes: Promise<number> } {
    const file = this.resolveKey(key);
    return { stream: createReadStream(file), sizeBytes: stat(file).then((s) => s.size) };
  }

  async getReadUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    this.resolveKey(key);
    if (!this.secret) throw new AppError({ code: "config", userMessage: "Armazenamento de arquivos indisponível no momento.", cause: new Error("AUTH_SECRET ausente para assinar URL local") });
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
    const q = new URLSearchParams({ key, exp: String(exp), sig: signLocalRead(this.secret, key, exp) });
    return `${LOCAL_READ_ROUTE}?${q.toString()}`;
  }

  async getUploadUrl(): Promise<string> {
    throw new AppError({ code: "config", userMessage: "Upload direto indisponível com o storage local.", cause: new Error("getUploadUrl não suportado no provider local") });
  }

  async list(prefix: string): Promise<StorageObjectInfo[]> {
    const out: StorageObjectInfo[] = [];
    const base = path.resolve(this.root, prefix);
    if (base !== this.root && !base.startsWith(this.root + path.sep)) throw new AppError({ code: "validation", userMessage: "Prefixo inválido." });
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) {
          const s = await stat(full);
          out.push({ key: path.relative(this.root, full).split(path.sep).join("/"), sizeBytes: s.size, lastModified: s.mtime });
        }
      }
    };
    await walk(base);
    return out.filter((o) => o.key.startsWith(prefix));
  }
}
