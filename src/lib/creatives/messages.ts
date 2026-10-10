import type { CreativeFailureKind } from "./types";

/** SPEC-051 — mensagens PT-BR seguras por tipo de falha (nunca corpo cru do provedor). */
export const FAILURE_MESSAGE: Record<CreativeFailureKind, string> = {
  provider_failed: "O provedor não conseguiu gerar o vídeo. Tente novamente.",
  provider_unavailable: "O provedor de vídeo está indisponível no momento. Tente novamente em alguns minutos.",
  provider_rejected: "O provedor recusou o roteiro, o avatar ou a voz escolhidos. Ajuste e tente novamente.",
  timeout: "A geração demorou mais que o esperado e foi interrompida. Tente novamente.",
  download: "O vídeo foi gerado, mas não foi possível baixá-lo. Tente novamente (não haverá nova cobrança).",
  storage: "O vídeo foi gerado, mas não foi possível salvá-lo. Tente novamente (não haverá nova cobrança).",
  canceled: "Geração cancelada.",
};
