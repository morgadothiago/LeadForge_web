/**
 * SPEC-022: nada de texto livre de erro chega ao app.
 * - `errorCategory`: erros de SearchRun/SchedulerRun viram CATEGORIA GENERICA por allowlist (fallback "erro"); o texto original nunca e devolvido.
 * - `redactText`: defesa em profundidade para textos curtos gerados internamente que precisam ser mantidos (pausedReason, mensagens de alerta).
 */
export const ERROR_CATEGORIES = [
  "limite de requisicoes",
  "tempo esgotado",
  "nao autorizado pelo provedor",
  "falha de conexao com o provedor",
  "erro interno",
  "erro",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

const RULES: [RegExp, ErrorCategory][] = [
  [/\b429\b|rate[\s_-]?limit|too many requests|quota|limite de requisi/i, "limite de requisicoes"],
  [/timeout|timed?[\s_-]?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline|abort|esgotad/i, "tempo esgotado"],
  [/\b40[13]\b|unauthori[sz]ed|forbidden|invalid[\s_-]*(api[\s_-]*)?(key|token|credential)|api[\s_-]?key|permission denied|nao autorizado/i, "nao autorizado pelo provedor"],
  [/ECONN\w*|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|fetch failed|network|socket|getaddrinfo|dns|connect|refused|\b50[234]\b|unavailable/i, "falha de conexao com o provedor"],
  [/internal|unexpected|exception|\b500\b|prisma|database|banco|stack|undefined|null/i, "erro interno"],
];

export function errorCategory(input: string | null | undefined): ErrorCategory | null {
  if (!input || !input.trim()) return null;
  for (const [re, cat] of RULES) if (re.test(input)) return cat;
  return "erro";
}

const SECRET_KEYS = "api[-_ ]?key|apikey|x-api-key|key|access[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|passwd|senha|sig|signature|auth";

export function redactText(input: string | null | undefined): string | null {
  if (!input) return null;
  return input
    // Authorization: <esquema> <credencial> (consome a credencial inteira) e "Bearer x" solto
    .replace(/\bauthorization\b["']?\s*[:=]?\s*(?:(?:bearer|basic)\s+)?[^\s,;"']+/gi, "authorization [redacted]")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "[redacted]")
    // JWT e prefixos de chave conhecidos
    .replace(/\beyJ[\w-]*(?:\.[\w-]+)*/g, "[redacted]")
    .replace(/\b(?:AIza|sk-|xox[bp]-|ghp_)[\w-]+/g, "[redacted]")
    // qualquer esquema (http, postgres, redis, amqp, ...)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[url]")
    // chave=valor / chave: valor / JSON "chave":"valor" (preserva aspas e a leitura)
    .replace(new RegExp(`(["']?)\\b(${SECRET_KEYS})\\b(["']?)(\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,&;}"']+)`, "gi"), (_m, q1: string, k: string, q2: string, sep: string, v: string) => {
      const q = v.startsWith('"') ? '"' : v.startsWith("'") ? "'" : "";
      return `${q1}${k}${q2}${sep}${q}[redacted]${q}`;
    })
    .replace(/\b(?:bearer|api[-_ ]?key|apikey|token|secret|senha|password)\s+(?!\[)[^\s,;]+/gi, (m) => `${m.split(/\s/)[0]} [redacted]`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    // erro de rede seguido do alvo, IPs, host:porta
    .replace(/\b(ECONN\w+|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|getaddrinfo)\s+[^\s,;]+/g, "$1 [host]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, "[host]")
    .replace(/\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}\]?(?::\d{1,5})?/gi, (m) => (/[0-9a-f]:[0-9a-f]/i.test(m) && m.split(":").length > 3 ? "[host]" : m))
    .replace(/\b[a-z0-9][\w-]*(?:\.[a-z0-9][\w-]*)*:\d{2,5}(?=[/\s,;)]|$)/gi, "[host]")
    // caminhos de arquivo/stack (apos URLs), inclusive com :linha:coluna
    .replace(/(?<![\w[])(?:[A-Za-z]:\\|\.{0,2}\/)?[\w@~.-]+(?:[/\\][\w@~.-]+)+(?::\d+){0,2}/g, "[path]")
    // hostnames com TLD (internos ou publicos)
    .replace(/\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intranet|svc|cluster|home|localdomain|localhost|com|net|org|io|dev|app|co|br|ai|cloud)\b/gi, "[host]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[num]")
    .replace(/\b\d{6,}\b/g, "[num]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Numero de WhatsApp mascarado: so os ultimos 4 digitos. */
export function maskNumber(n: string | null | undefined): string | null {
  const d = (n ?? "").replace(/\D/g, "");
  if (!d) return null;
  return `••••${d.slice(-4)}`;
}
