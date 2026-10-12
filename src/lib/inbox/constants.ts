/** SPEC-068a: constantes da caixa de atendimento de WhatsApp. Nenhuma regra de tempo usa `Date.now()`: tudo recebe `now` por parâmetro. */

/** D-068-4: a resposta manual só é liberada até 24h após a última mensagem do lead. Política NOSSA anti-ban (a Evolution não impõe essa janela). */
export const CONVERSATION_WINDOW_MS = 24 * 3600_000;
/** D-068-5: espaçamento mínimo entre envios (manual ou automático) da mesma instância. */
export const MANUAL_MIN_GAP_MS = 3_000;
/** D-068-5: teto de envios manuais por instância por minuto. */
export const MANUAL_MAX_PER_MINUTE = 20;
/** D-068-5: fração do `dailyLimit` efetivo que o scheduler automático deixa livre para respostas manuais. */
export const MANUAL_RESERVE_PCT = 0.2;
/** Texto da resposta manual: 1 a 4096 caracteres. */
export const MESSAGE_MAX_CHARS = 4096;
export const PREVIEW_MAX_CHARS = 120;
export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 50;
/** Janela em que o eco `fromMe` ainda pode "adotar" uma mensagem manual que está em `sending` (o eco pode chegar antes da resposta do `sendText`). */
export const ECHO_ADOPT_WINDOW_MS = 2 * 60_000;
/** Métrica informativa (sem teto no MVP, D-068-5): respostas manuais por mês. `UsageCounter.metric` é texto livre. */
export const MANUAL_REPLIES_METRIC = "manual_replies";

/**
 * Reserva de respostas manuais dentro do limite diário efetivo `eff`: o automático só usa `eff - reserva`.
 * Arredonda para BAIXO: limites efetivos pequenos (< 5, dias 1-3 do aquecimento: 3/dia) não reservam nada e a rampa da SPEC-017 segue idêntica
 * (o manual ainda é limitado pelo teto total). Ex.: 6 -> 1, 10 -> 2, 30 -> 6.
 */
export function manualReserve(eff: number): number {
  return Math.max(0, Math.floor(eff * MANUAL_RESERVE_PCT));
}
