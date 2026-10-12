/**
 * SPEC-064 (D-064-4/5) — forca da senha, 100% LOCAL e pura (nada sai do navegador, nada e logado).
 * E so orientacao: nao bloqueia o envio (o unico bloqueio e o minimo de 6 caracteres do schema).
 */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;
export type PasswordStrength = { level: StrengthLevel; label: string; hint: string };

export const STRENGTH_LABELS = ["", "Muito fraca", "Fraca", "Razoável", "Forte"] as const;

const COMMON = [
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345", "111111", "000000", "654321", "123123", "112233", "121212",
  "password", "passw0rd", "senha", "senha123", "senha1234", "senha12345", "mudar123", "admin", "admin123", "qwerty", "qwerty123", "qwertyuiop",
  "abc123", "abcdef", "abcd1234", "iloveyou", "letmein", "welcome", "brasil", "brasil123", "123mudar", "teste", "teste123",
];
const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
const deLeet = (s: string) => s.replace(/[0134578@$]/g, (c) => LEET[c] ?? c);

function isCommon(p: string): boolean {
  const n = norm(p);
  if (COMMON.includes(n)) return true;
  // senha comum + 1-3 digitos/simbolos no fim (ex. "password99!").
  const stripped = n.replace(/[\d!@#$%^&*._-]{1,3}$/, "");
  return stripped.length >= 4 && COMMON.includes(stripped);
}

function isSequenceOrRepeat(p: string): boolean {
  const n = norm(p);
  if (/^(.{1,3})\1+$/.test(n)) return true; // "aaaaaa", "abab12"? so repeticao pura de bloco curto
  for (const seq of SEQUENCES) {
    const rev = [...seq].reverse().join("");
    for (let i = 0; i + 5 <= seq.length; i++) {
      if (n.includes(seq.slice(i, i + 5)) || n.includes(rev.slice(i, i + 5))) return n.length <= 12;
    }
  }
  return false;
}

function matchesPersonal(p: string, personal: string[]): boolean {
  const n = deLeet(norm(p));
  return personal.some((raw) => {
    const t = norm(raw.trim());
    if (!t) return false;
    const local = t.includes("@") ? t.split("@")[0] : t;
    const parts = [t, local, ...t.split(/[\s.@_-]+/)].filter((x) => x.length >= 4);
    return parts.some((x) => n === x || n === deLeet(x) || (x.length >= 5 && n.includes(x) && n.length <= x.length + 3));
  });
}

/** `personal`: e-mail/nome informados no mesmo formulario (a senha nao deve ser igual a eles). */
export function scorePassword(password: string, personal: string[] = []): PasswordStrength {
  if (!password) return { level: 0, label: "", hint: "" };
  const len = password.length;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const unique = new Set(password).size;

  let issue: string | null = null;
  if (isCommon(password)) issue = "Evite senhas comuns como 123456 ou senha123.";
  else if (matchesPersonal(password, personal)) issue = "Evite usar seu nome ou e-mail na senha.";
  else if (isSequenceOrRepeat(password) || unique <= 2) issue = "Evite sequências e repetições (abc, 1111).";

  if (issue) return { level: 1, label: STRENGTH_LABELS[1], hint: issue };

  let points = len >= 12 ? 3 : len >= 8 ? 2 : len >= 6 ? 1 : 0;
  points += classes >= 3 ? 2 : classes === 2 ? 1 : 0;
  if (unique < Math.ceil(len / 2)) points -= 1;
  let level: StrengthLevel = points >= 5 ? 4 : points >= 4 ? 3 : points >= 2 ? 2 : 1;
  if (len < 8 && level > 2) level = 2;
  if (len < 12 && classes < 2 && level > 2) level = 2;

  const hint =
    level === 4 ? "Boa senha." :
    len < 8 ? "Use 8 ou mais caracteres." :
    classes < 3 ? "Misture letras maiúsculas, minúsculas, números e símbolos." :
    len < 12 ? "Senhas com 12 ou mais caracteres são bem mais seguras." :
    "Misture mais tipos de caracteres.";
  return { level, label: STRENGTH_LABELS[level], hint };
}
