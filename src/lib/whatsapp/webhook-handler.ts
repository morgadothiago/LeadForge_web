import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { tooManyRequests } from "@/lib/http";
import { decrypt } from "@/lib/crypto/secret-box";
import { processInbound } from "@/lib/domain/whatsapp-inbound";
import { isRetryableTxConflict } from "@/lib/db/tx-conflict";
import { inboxErrorForLog } from "@/lib/inbox/text";
import { recordInboundMessage, recordOutboundEcho } from "@/lib/inbox/record";
import { getWhatsAppProvider, type StatusEvent, type WebhookEvent, type WhatsAppProvider } from "./provider";
import { invalidAttemptRetry, validTrafficRetry } from "./webhook-rate-limit";
import { redactWebhookToken } from "./redact";
import { evaluateInstanceHealth, onConnectionChange } from "./health";

/** 32 bytes em base64url = 43 caracteres. Formato inválido nunca chega ao banco nem cria chave de rate limit. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 1_000_000;
const MAX_TX_ATTEMPTS = 3;
const SOURCE = "whatsapp";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
/** Idêntica para token malformado, inexistente ou errado. */
const unauthorized = (): Response => json(401, { error: "unauthorized", message: "Não autorizado." });
const ok = (result: string): Response => json(200, { ok: true, result });

export interface HandlerOptions {
  now?: Date;
  /** Testes: provider injetado (default: getWhatsAppProvider(instance.provider)). */
  provider?: WhatsAppProvider;
}

function log(msg: string): void {
  console.info(`[whatsapp-webhook] ${redactWebhookToken(msg)}`);
}

async function updateStatus(instance: { id: string; status: string }, ev: Extract<StatusEvent, { kind: "connection" | "qrcode" }>, now: Date): Promise<void> {
  if (ev.kind === "connection") {
    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: ev.status === "connected" ? { status: "connected", lastConnectedAt: now, lastError: null } : { status: ev.status },
    });
    // SPEC-017: 1ª conexão inicia o aquecimento; desconexão de instância conectada pausa o envio.
    await onConnectionChange(instance, ev.status, now, { loggedOut: ev.loggedOut });
  } else {
    // QR novo = sessão ainda não pareada. O QR em si não é armazenado (a tela usa getInstanceQr).
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status: "connecting" } });
  }
}

/**
 * SPEC-068a (D-068-2): a gravação da caixa NUNCA pode impedir pausa/opt-out do `processInbound` (opt-out é prioridade). Roda sob SAVEPOINT:
 * erro de banco da caixa desfaz só ela e a transação do webhook segue. Conflito de serialização/deadlock sobe (o webhook inteiro é repetido).
 */
async function inboxSafe<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T | null> {
  await tx.$executeRaw`SAVEPOINT inbox_068`;
  try {
    const r = await fn();
    await tx.$executeRaw`RELEASE SAVEPOINT inbox_068`;
    return r;
  } catch (e) {
    if (isRetryableTxConflict(e)) throw e;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT inbox_068`; // se falhar, a transação já está perdida: o erro sobe
    console.error("[whatsapp-webhook] falha ao gravar a caixa de atendimento (ignorada):", inboxErrorForLog(e));
    return null;
  }
}

/**
 * delivered/read só avançam sent -> delivered; failed só a partir de sent. Nunca regride.
 * SPEC-068a: o mesmo vale para `WaMessage` (sending < sent < delivered < read; `read` é novo valor).
 */
async function applyMessageStatus(tx: Prisma.TransactionClient, instanceId: string, ev: Extract<StatusEvent, { kind: "message_status" }>): Promise<void> {
  const where = { externalId: ev.externalId, whatsappInstanceId: instanceId, channel: "whatsapp", direction: "outbound" } as const;
  if (ev.status === "delivered" || ev.status === "read") {
    await tx.touch.updateMany({ where: { ...where, status: { in: ["sending", "sent"] } }, data: { status: "delivered" } });
  } else if (ev.status === "failed") {
    await tx.touch.updateMany({ where: { ...where, status: "sent" }, data: { status: "failed", error: "O WhatsApp reportou falha na entrega." } });
  }
  await inboxSafe(tx, async () => {
    const w = { externalId: ev.externalId, whatsappInstanceId: instanceId, direction: "outbound" } as const;
    if (ev.status === "read") await tx.waMessage.updateMany({ where: { ...w, status: { in: ["sending", "sent", "delivered"] } }, data: { status: "read", error: null } });
    else if (ev.status === "delivered") await tx.waMessage.updateMany({ where: { ...w, status: { in: ["sending", "sent"] } }, data: { status: "delivered", error: null } });
    else if (ev.status === "sent") await tx.waMessage.updateMany({ where: { ...w, status: "sending" }, data: { status: "sent" } });
    else await tx.waMessage.updateMany({ where: { ...w, status: "sent" }, data: { status: "failed", error: "O WhatsApp reportou falha na entrega." } });
  });
}

async function persist(instance: { id: string; orgId: string }, ev: Exclude<WebhookEvent, { kind: "connection" | "qrcode" }>, now: Date): Promise<string> {
  const eventId = ev.kind === "inbound" ? `wa:${instance.id}:upsert:${ev.externalId}`
    : ev.kind === "outbound_echo" ? `wa:${instance.id}:echo:${ev.externalId}`
    : `wa:${instance.id}:update:${ev.externalId}:${ev.status}`;
  try {
    return await withSerializableRetry(
      () => prisma.$transaction(
        async (tx) => {
          // Sem texto, telefone ou token: só o necessário para auditoria/idempotência.
          await tx.webhookEvent.create({
            data: { source: SOURCE, orgId: instance.orgId, eventId, processedAt: now, payload: { kind: ev.kind, instance: ev.instanceName, externalId: ev.externalId } },
          });
          if (ev.kind === "message_status") {
            await applyMessageStatus(tx, instance.id, ev);
            return "status";
          }
          if (ev.kind === "outbound_echo") {
            // SPEC-068a: eco do que enviamos. Só a caixa muda (processInbound não participa: não é resposta de lead).
            const outcome = await inboxSafe(tx, () => recordOutboundEcho(tx, instance, ev, now));
            return `echo_${outcome ?? "inbox_error"}`;
          }
          const r = await processInbound(tx, instance, ev, now);
          if (r.status === "lead_not_found") {
            log(`lead não encontrado para mensagem recebida (instância=${ev.instanceName}); ignorada`);
            return "lead_not_found";
          }
          await inboxSafe(tx, () => recordInboundMessage(tx, instance, r.leadId, ev, now));
          return r.kind;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      { attempts: MAX_TX_ATTEMPTS },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate"; // eventId já processado
    throw e;
  }
}

/** Lê o stream com teto real de bytes (sem confiar em content-length). null = excedeu o teto (o stream é cancelado). */
async function readBodyLimited(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/**
 * Receiver do webhook do WhatsApp (SPEC-012). Ordem: formato do token -> instância pelo token -> verify (tempo constante + apikey opcional)
 * -> rate limit (global/token) -> parseWebhook (400) -> conferência de instância -> processamento no banco. Sem chamada externa síncrona.
 */
export async function handleWhatsAppWebhook(request: Request, token: string, opts: HandlerOptions = {}): Promise<Response> {
  const now = opts.now ?? new Date();
  try {
    if (!TOKEN_RE.test(token)) {
      const wait = await invalidAttemptRetry(now.getTime());
      return wait === null ? unauthorized() : tooManyRequests(wait);
    }
    const instance = await prisma.whatsAppInstance.findUnique({ where: { webhookToken: token } });
    if (!instance) {
      const wait = await invalidAttemptRetry(now.getTime());
      return wait === null ? unauthorized() : tooManyRequests(wait);
    }
    const provider = opts.provider ?? getWhatsAppProvider(instance.orgId, instance.provider);
    let apiKey: string | null = null;
    if (instance.apiKey) {
      try { apiKey = decrypt(instance.apiKey); } catch { log(`apiKey da instância ${instance.instanceName} ilegível; 2º fator ignorado`); }
    }
    // Teto REAL de bytes ANTES de verify/parse: ambos passam a operar sobre uma cópia já limitada (nunca relêem corpo ilimitado).
    const bytes = await readBodyLimited(request, MAX_BODY_BYTES);
    if (!bytes) return json(413, { error: "payload_too_large", message: "Corpo da requisição grande demais." });
    request = new Request(request.url, { method: request.method, headers: request.headers, body: bytes.byteLength ? (bytes as unknown as BodyInit) : undefined });
    if (!(await provider.verifyWebhook(request, { webhookToken: instance.webhookToken, apiKey }, token))) return unauthorized();

    const wait = await validTrafficRetry(token, now.getTime());
    if (wait !== null) return tooManyRequests(wait);

    let event: WebhookEvent | null;
    try {
      event = await provider.parseWebhook(request);
    } catch (e) {
      if (e instanceof AppError && e.code === "validation") return json(400, { error: "invalid_payload", message: "Payload de webhook inválido." });
      throw e;
    }
    if (!event) return ok("ignored");
    if (event.instanceName !== instance.instanceName) return unauthorized(); // token de uma instância usado com evento de outra

    if (event.kind === "connection" || event.kind === "qrcode") {
      await updateStatus(instance, event, now);
      return ok("status_updated");
    }
    const result = await persist(instance, event, now);
    if (event.kind === "message_status") await evaluateInstanceHealth(instance.id, now);
    return ok(result);
  } catch (e) {
    console.error("[whatsapp-webhook] erro:", redactWebhookToken(safeErrorForLog(e)));
    return json(500, { error: "internal_error", message: "Não foi possível processar o webhook." });
  }
}
