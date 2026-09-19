import { formatPhone } from "@/components/leads/lead-format";

export type WaStatusKey = "connected" | "connecting" | "disconnected";

export const WA_STATUS_INFO: Record<WaStatusKey, { label: string; description: string; tone: "ok" | "wait" | "off" }> = {
  connected: { label: "Conectado", description: "Instância pronta para enviar mensagens.", tone: "ok" },
  connecting: { label: "Conectando", description: "Aguardando a leitura do QR code.", tone: "wait" },
  disconnected: { label: "Desconectado", description: "Conecte lendo o QR code para voltar a enviar.", tone: "off" },
};

/** Número E.164 da instância para exibição: +5511912345678 -> (11) 91234-5678. */
export const formatInstanceNumber = (number: string): string => formatPhone(number) || number;

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Só aceita `data:image/png;base64,<base64>`; qualquer outra coisa (URL, SVG, HTML) vira null. Uso: <img src>, nunca innerHTML. */
export function safeQrSrc(qr: string | null | undefined): string | null {
  if (!qr) return null;
  const v = qr.trim();
  return v.length <= 200_000 && PNG_DATA_URL.test(v) ? v : null;
}

/** Substitui o token (segredo) da URL do webhook por "…abcd". Sem o token na URL, mascara o último segmento do caminho. */
export function maskWebhookUrl(url: string, token: string): string {
  const hint = `…${token.slice(-4)}`;
  if (token && url.includes(token)) return url.split(token).join(hint);
  return url.replace(/[A-Za-z0-9_-]{20,}/g, hint);
}
