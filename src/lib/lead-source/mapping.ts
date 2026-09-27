import { normalizeBrPhone } from "@/lib/domain/phone";

/**
 * Mapeamento de campos FIXO (D-041-2): nome/telefone/e-mail/empresa vão pros campos padrão do `Lead`;
 * qualquer campo extra do formulário (pergunta customizada) vai pro `Lead.rawData`, sem UI de mapeamento
 * configurável nesta fase. Compartilhado pelos dois webhooks (Google Ads e Meta) — cada um só normaliza o
 * formato de entrada da plataforma (`user_column_data` / `field_data`) pra uma lista comum de `{key, value}`.
 */
export interface RawField {
  key: string;
  value: string;
}

export interface ExtractedContact {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** Telefone bruto quando não normalizável para BR (E.164 falhou) — nunca descartado, só não vai pro campo padrão. */
  rawData: Record<string, string>;
}

const NAME_KEYS = new Set(["full_name", "name"]);
const FIRST_NAME_KEYS = new Set(["first_name"]);
const LAST_NAME_KEYS = new Set(["last_name"]);
const EMAIL_KEYS = new Set(["email", "work_email"]);
const PHONE_KEYS = new Set(["phone_number", "phone", "work_phone"]);
const COMPANY_KEYS = new Set(["company_name", "company"]);

const norm = (k: string) => k.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function extractContact(fields: RawField[]): ExtractedContact {
  const rawData: Record<string, string> = {};
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let company: string | null = null;

  for (const { key, value } of fields) {
    if (!value) continue;
    const k = norm(key);
    if (NAME_KEYS.has(k) && !fullName) fullName = value.trim();
    else if (FIRST_NAME_KEYS.has(k) && !firstName) firstName = value.trim();
    else if (LAST_NAME_KEYS.has(k) && !lastName) lastName = value.trim();
    else if (EMAIL_KEYS.has(k) && !email) {
      const v = value.trim().toLowerCase();
      if (EMAIL_RE.test(v)) email = v;
      else rawData[key] = value;
    } else if (PHONE_KEYS.has(k) && !phone) {
      const r = normalizeBrPhone(value.trim());
      if (r.ok) phone = r.e164;
      else rawData[key] = value; // preservado bruto: não descarta o dado, só não vai pro campo padrão
    } else if (COMPANY_KEYS.has(k) && !company) company = value.trim();
    else rawData[key] = value;
  }

  const name = fullName ?? ([firstName, lastName].filter(Boolean).join(" ").trim() || "Lead sem nome");
  return { name, email, phone, company, rawData };
}

/** Google Ads: `user_column_data: [{ column_id, column_name, string_value }]`. `column_id`/`column_name` costumam ser MAIÚSCULOS. */
export function fieldsFromGoogleUserColumnData(data: unknown): RawField[] {
  if (!Array.isArray(data)) return [];
  const out: RawField[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.column_id === "string" ? o.column_id : typeof o.column_name === "string" ? o.column_name : null;
    const value = typeof o.string_value === "string" ? o.string_value : null;
    if (key && value != null) out.push({ key, value });
  }
  return out;
}

/** Meta: `field_data: [{ name, values: [string] }]`. */
export function fieldsFromMetaFieldData(data: unknown): RawField[] {
  if (!Array.isArray(data)) return [];
  const out: RawField[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.name === "string" ? o.name : null;
    const value = Array.isArray(o.values) && typeof o.values[0] === "string" ? (o.values[0] as string) : null;
    if (key && value != null) out.push({ key, value });
  }
  return out;
}
