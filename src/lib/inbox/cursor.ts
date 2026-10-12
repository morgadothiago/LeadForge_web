const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const UUID_RE = new RegExp(`^${UUID}$`, "i");

/** Cursor opaco `timestampMs|id` em base64url (lista de conversas = lastMessageAt; mensagens = messageAt). */
export const encodeCursor = (at: Date, id: string): string => Buffer.from(`${at.getTime()}|${id}`).toString("base64url");

export function decodeCursor(c: string): { at: Date; id: string } | null {
  if (c.length > 120) return null;
  const raw = Buffer.from(c, "base64url").toString("utf8");
  const m = new RegExp(`^(\\d{1,15})\\|(${UUID})$`, "i").exec(raw);
  if (!m || Buffer.from(raw).toString("base64url") !== c) return null;
  return { at: new Date(Number(m[1])), id: m[2].toLowerCase() };
}
