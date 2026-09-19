export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

export const PHONE_ERROR =
  "Telefone inválido. Use celular brasileiro: DDD + 9 + 8 dígitos (ex.: (11) 91234-5678), com ou sem +55.";

/**
 * Normaliza celular brasileiro para E.164 (+55DDD9XXXXXXXX). Aceita máscara, espaços e 55/+55 opcional.
 * Regra da SPEC-008: 55 + DDD (2 dígitos, 11-99) + 9 + 8 dígitos. Fixos não são aceitos.
 */
export function normalizeBrPhone(raw: string): PhoneResult {
  const digits = raw.replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: PHONE_ERROR };
  const national = digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (!/^[1-9][1-9]9\d{8}$/.test(national)) return { ok: false, error: PHONE_ERROR };
  return { ok: true, e164: `+55${national}` };
}
