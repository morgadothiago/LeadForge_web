/**
 * SPEC-050 — checagem de magic bytes (o MIME declarado pelo cliente nao e confiavel). Tipos com
 * assinatura conhecida DEVEM casar; `text/*` nao pode conter NUL; qualquer outro tipo e rejeitado
 * (nao verificavel) mesmo que esteja na allowlist.
 */
const startsWith = (b: Uint8Array, sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
const ascii = (b: Uint8Array, off: number, s: string) => [...s].every((c, i) => b[off + i] === c.charCodeAt(0));

const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) => ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"),
  "image/webp": (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"),
  "application/pdf": (b) => ascii(b, 0, "%PDF"),
  "video/mp4": (b) => ascii(b, 4, "ftyp"),
  "video/webm": (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
};

/** Quantos bytes iniciais o service precisa ler antes de validar. */
export const MAGIC_HEAD_BYTES = 16;

export function matchesMagic(mime: string, head: Uint8Array): boolean {
  if (head.length === 0) return false;
  const check = CHECKS[mime];
  if (check) return check(head);
  if (mime.startsWith("text/")) return !head.includes(0);
  return false;
}
