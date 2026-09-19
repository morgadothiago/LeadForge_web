import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";

export const BLOCKED_HOST_MESSAGE = "Host não permitido: aponta para rede interna.";

export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export function allowPrivateSmtpHosts(): boolean {
  return process.env.ALLOW_PRIVATE_SMTP_HOSTS?.trim().toLowerCase() === "true";
}

function v4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/** true se o IP (v4/v6 literal) é loopback, privado, link-local, metadados, não especificado, CGNAT ou multicast. */
export function isBlockedIp(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const kind = isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind !== 6) return true; // formato desconhecido: bloqueia
  const mapped = ip.match(/^(?:0{0,4}:){2,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return v4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip === "::" || ip === "::1") return true;
  const first = parseInt(ip.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

/**
 * Resolve o host e garante que NENHUM IP é interno (anti-SSRF). Devolve o IP checado para conectar direto nele
 * (evita DNS rebinding entre checagem e conexão). Com ALLOW_PRIVATE_SMTP_HOSTS=true não checa e devolve o host.
 */
export async function resolvePublicHost(host: string, resolver: HostResolver = defaultResolver): Promise<string> {
  if (allowPrivateSmtpHosts()) return host;
  const bare = host.trim().replace(/^\[|\]$/g, "");
  let ips: string[];
  if (isIP(bare)) ips = [bare];
  else {
    try {
      ips = await resolver(bare);
    } catch (e) {
      throw Object.assign(new Error("dns"), { code: "ENOTFOUND", cause: e });
    }
  }
  if (!ips.length) throw Object.assign(new Error("dns"), { code: "ENOTFOUND" });
  if (ips.some(isBlockedIp)) throw new AppError({ code: "config", userMessage: BLOCKED_HOST_MESSAGE });
  return ips[0];
}
