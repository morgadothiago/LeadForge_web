/** Aceita apenas caminhos internos ("/x"); rejeita "//host", "/\host", URLs absolutas, controle/espacos. Fallback "/". */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(next.split("?")[0])) return fallback; // barra/controle codificados
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return fallback;
  return next;
}
