import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { AppError } from "@/lib/errors";
import { isBlockedIp } from "@/lib/channels/ssrf";

/**
 * Guarda SSRF das integrações (SPEC-018). Reusa `isBlockedIp` de channels/ssrf.ts como rede de segurança, mas NÃO usa
 * `resolvePublicHost` (ele tem o atalho ALLOW_PRIVATE_SMTP_HOSTS, que jamais deve liberar metadados de integração).
 *  - metadados/link-local/multicast/não especificado/CGNAT: SEMPRE bloqueados;
 *  - loopback e redes privadas (127/8, ::1, 10/8, 172.16/12, 192.168/16, fc00::/7): só com `allowPrivateHost` (confirmação do admin).
 */
export const BLOCKED_ALWAYS_MESSAGE = "Endereço não permitido: aponta para metadados/rede reservada (sempre bloqueado).";
export const BLOCKED_PRIVATE_MESSAGE = "Endereço aponta para rede interna/localhost. Marque \"instância própria\" para permitir.";

export const GENERIC_HOST_MESSAGE = "Não foi possível conectar ao servidor informado. Verifique o endereço, a porta e se o serviço está no ar.";

export type IpClass = "public" | "private" | "blocked";
export type IntegrationResolver = (host: string) => Promise<string[]>;

const defaultResolver: IntegrationResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
let resolver: IntegrationResolver = defaultResolver;
/** Só testes. */
export function _setIntegrationResolver(r: IntegrationResolver | null): void {
  resolver = r ?? defaultResolver;
}

const METADATA_HOSTS = new Set([
  "metadata.google.internal", "metadata.goog", "metadata", "instance-data", "instance-data.ec2.internal", "kubernetes.default.svc",
]);

/** Remove colchetes e ponto(s) final(is) ("localhost." / "metadata.google.internal." valem como sem o ponto). */
export function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/**
 * Formas alternativas de IPv4 (inet_aton): decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.1`, 1-4 partes.
 * Devolve o dotted-quad, `null` se o host não é numérico, ou `"invalid"` se é numérico mas fora de faixa (tratado como bloqueado).
 */
export function normalizeIPv4Host(host: string): string | "invalid" | null {
  const labels = host.split(".");
  if (labels.length < 1 || labels.length > 4) return /^(0x[0-9a-f]*|\d+)$/i.test(labels[labels.length - 1]) ? "invalid" : null;
  const nums: number[] = [];
  for (const l of labels) {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(l)) n = parseInt(l.slice(2), 16);
    else if (/^0[0-7]+$/.test(l)) n = parseInt(l, 8);
    else if (/^\d+$/.test(l) && !/^0\d/.test(l)) n = Number(l);
    else return /^\d+$|^0x[0-9a-f]*$/i.test(l) ? "invalid" : null; // 08 / 0x sem dígitos -> inválido; resto = hostname comum
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  const head = nums.slice(0, -1);
  if (head.some((n) => n > 255) || last >= 256 ** (4 - head.length)) return "invalid";
  let v = last;
  head.forEach((n, i) => { v += n * 256 ** (3 - i); });
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

function v4Class(ip: string): IpClass {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a >= 224) return "blocked"; // 0/8, multicast 224/4, reservado 240/4, broadcast
  if (a === 169 && b === 254) return "blocked"; // link-local + metadados
  if (a === 100 && b >= 64 && b <= 127) return "blocked"; // CGNAT 100.64/10 (inclui 100.100.100.200 Alibaba)
  if (a === 192 && b === 0 && c === 0) return "blocked"; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return "blocked"; // 198.18/15 benchmark
  if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  return "public";
}

/** Expande IPv6 (com `::` e/ou IPv4 embutido no fim) para 8 grupos de 16 bits; `null` se malformado. */
function parseV6(ip: string): number[] | null {
  let s = ip;
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const o = m[2].split(".").map(Number);
    if (o.length !== 4 || o.some((n) => n > 255)) return null;
    s = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const all = [...head, ...new Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return all.length === 8 && all.every((n) => Number.isInteger(n)) ? all : null;
}

const embedded = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
/** Faixas de transição: destino privado/reservado embutido nunca é liberado (nem com allowPrivateHost). */
const viaTransition = (v4: string): IpClass => (v4Class(v4) === "public" ? "public" : "blocked");

function v6Class(ip: string): IpClass {
  const g = parseV6(ip);
  if (!g) return "blocked";
  const zeros = (from: number, to: number) => g.slice(from, to).every((n) => n === 0);
  if (zeros(0, 8)) return "blocked"; // ::
  if (zeros(0, 7) && g[7] === 1) return "private"; // ::1
  if (zeros(0, 5) && g[5] === 0xffff) return v4Class(embedded(g[6], g[7])); // ::ffff:0:0/96 IPv4-mapped
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) return viaTransition(embedded(g[6], g[7])); // ::ffff:0:0:0/96 SIIT
  if (zeros(0, 6)) return "blocked"; // ::/96 IPv4-compatível (obsoleto): bloqueia sempre
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return "blocked"; // 64:ff9b:1::/48 NAT64 de uso local
    if (zeros(2, 6)) return viaTransition(embedded(g[6], g[7])); // 64:ff9b::/96
  }
  if (g[0] === 0x2002) return viaTransition(embedded(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return "blocked"; // Teredo 2001::/32
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return "blocked"; // link-local, site-local, multicast
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return "blocked"; // metadados AWS IPv6 (fd00:ec2::/32)
  if ((g[0] & 0xfe00) === 0xfc00) return "private";
  return "public";
}

export function classifyIp(raw: string): IpClass {
  let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!isIP(ip)) {
    const n = normalizeIPv4Host(ip);
    if (n && n !== "invalid") ip = n;
  }
  const kind = isIP(ip);
  const cls: IpClass = kind === 4 ? v4Class(ip) : kind === 6 ? v6Class(ip) : "blocked";
  // Rede de segurança: o que o guard legado bloqueia e aqui virou "public" continua bloqueado.
  if (cls === "public" && isBlockedIp(ip)) return "blocked";
  return cls;
}

export interface ParsedIntegrationUrl {
  /** URL normalizada (sem barra final). */
  url: string;
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
}

const bad = (msg: string) => new AppError({ code: "validation", userMessage: msg });

/** Validação sintática: http/https, sem credenciais, sem fragmento, sem query, porta 1-65535. */
export function parseIntegrationUrl(raw: string): ParsedIntegrationUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad("URL inválida.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw bad("A URL deve começar com http:// ou https://.");
  if (u.username || u.password) throw bad("A URL não pode conter usuário/senha embutidos.");
  if (u.hash) throw bad("A URL não pode conter fragmento (#).");
  if (u.search) throw bad("A URL não pode conter parâmetros (?).");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad("Porta inválida.");
  const hostname = normalizeHostname(u.hostname);
  if (!hostname) throw bad("URL sem host.");
  const path = u.pathname.replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host}${path}`, protocol: u.protocol, hostname, port };
}

/**
 * Resolve o host e checa TODOS os IPs. Devolve o IP checado (conectar nele: `pinnedAgents`).
 * `allowPrivateHost` só libera "private"; "blocked" (metadados etc.) nunca.
 */
export async function assertAllowedHost(hostname: string, allowPrivateHost: boolean): Promise<{ ip: string; family: 4 | 6 }> {
  const bare = normalizeHostname(hostname);
  if (METADATA_HOSTS.has(bare)) throw new AppError({ code: "config", userMessage: BLOCKED_ALWAYS_MESSAGE });
  const numeric = isIP(bare) ? null : normalizeIPv4Host(bare);
  if (numeric === "invalid") throw new AppError({ code: "config", userMessage: BLOCKED_ALWAYS_MESSAGE });
  let ips: string[];
  if (isIP(bare)) ips = [bare];
  else if (numeric) ips = [numeric];
  else if (bare === "localhost" || bare.endsWith(".localhost")) ips = ["127.0.0.1"];
  else {
    try {
      ips = await resolver(bare);
    } catch (e) {
      // Mensagem única: não distingue DNS inexistente de outras falhas (evita oráculo de rede interna).
      throw new AppError({ code: "config", userMessage: GENERIC_HOST_MESSAGE, cause: e });
    }
  }
  if (!ips.length) throw new AppError({ code: "config", userMessage: GENERIC_HOST_MESSAGE });
  const classes = ips.map(classifyIp);
  if (classes.includes("blocked")) throw new AppError({ code: "config", userMessage: BLOCKED_ALWAYS_MESSAGE });
  if (classes.includes("private") && !allowPrivateHost) throw new AppError({ code: "config", userMessage: BLOCKED_PRIVATE_MESSAGE });
  const ip = ips[0].replace(/^\[|\]$/g, "").split("%")[0];
  return { ip, family: isIP(ip) === 6 ? 6 : 4 };
}

/** Agents que fixam a conexão no IP já checado (Host/SNI continuam sendo o hostname): fecha a janela de DNS rebinding. */
export function pinnedAgents(ip: string, family: 4 | 6): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  const lookupFn = ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts?.all) cb(null, [{ address: ip, family }]);
    else cb(null, ip, family);
  }) as never;
  return { httpAgent: new HttpAgent({ lookup: lookupFn }), httpsAgent: new HttpsAgent({ lookup: lookupFn }) };
}

/** Host para exibição/auditoria sem expor o endereço completo. */
export function maskHost(hostname: string): string {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isIP(h) === 4) return `${h.split(".")[0]}.*.*.*`;
  if (isIP(h) === 6) return "[***]";
  const [first, ...rest] = h.split(".");
  const head = `${first.slice(0, 2)}***`;
  return rest.length ? `${head}.${rest.join(".")}` : head;
}
