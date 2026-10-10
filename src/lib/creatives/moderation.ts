import type { CreativeConfig } from "./config";

/**
 * SPEC-051 (D-051-7) — moderacao MINIMA do roteiro: limite de tamanho e blocklist simples configuravel
 * (`CREATIVE_SCRIPT_BLOCKLIST`, termos separados por virgula; comparacao sem acento/caixa, substring).
 * IMPORTANTE: isto NAO e moderacao de conteudo real (violencia, fraude, uso indevido de imagem/voz); a moderacao
 * de verdade depende dos termos/filtros do provedor escolhido e deve ser revisada ao adotar um adapter real.
 */
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function moderateScript(script: string, cfg: Pick<CreativeConfig, "maxScriptChars" | "blocklist">): string | null {
  if (script.length > cfg.maxScriptChars) return `O roteiro excede o limite de ${cfg.maxScriptChars} caracteres.`;
  const text = norm(script);
  if (cfg.blocklist.some((t) => norm(t) && text.includes(norm(t)))) return "O roteiro contém termos não permitidos.";
  return null;
}

/** ~150 palavras/minuto de fala (2,5 palavras/s). Estimativa grosseira so para validar limite e custo. */
export function estimateDurationSec(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 2.5));
}
