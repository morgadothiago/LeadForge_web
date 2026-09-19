import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { tooManyRequests } from "@/lib/http";
import { decrypt } from "@/lib/crypto/secret-box";
import { processInbound } from "@/lib/domain/whatsapp-inbound";
import { getWhatsAppProvider, type StatusEvent, type WebhookEvent, type WhatsAppProvider } from "./provider";
import { invalidAttemptRetry, validTrafficRetry } from "./webhook-rate-limit";
import { redactWebhookToken } from "./redact";

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

async function updateStatus(instance: { id: string }, ev: Extract<StatusEvent, { kind: "connection" | "qrcode" }>, now: Date): Promise<void> {
  if (ev.kind === "connection") {
    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: ev.status === "connected" ? { status: "connected", lastConnectedAt: now, lastError: null } : { status: ev.status },
    });
  } else {
    // QR novo = sessão ainda não pareada. O QR em si não é armazenado (a tela usa getInstanceQr).
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status: "connecting" } });
  }
}

/** delivered/read só avançam sent -> delivered; failed só a partir de sent. Nunca regride. */
async function applyMessageStatus(tx: Prisma.TransactionClient, instanceId: string, ev: Extract<StatusEvent, { kind: "message_status" }>): Promise<void> {
  const where = { externalId: ev.externalId, whatsappInstanceId: instanceId, channel: "whatsapp", direction: "outbound" } as const;
  if (ev.status === "delivered" || ev.status === "read") {
    await tx.touch.updateMany({ where: { ...where, status: { in: ["sending", "sent"] } }, data: { status: "delivered" } });
  } else if (ev.status === "failed") {
    await tx.touch.updateMany({ where: { ...where, status: "sent" }, data: { status: "failed", error: "O WhatsApp reportou falha na entrega." } });
  }
}

async function persist(instance: { id: string }, ev: Exclude<WebhookEvent, { kind: "connection" | "qrcode" }>, now: Date): Promise<string> {
  const eventId = ev.kind === "inbound" ? `wa:${instance.id}:upsert:${ev.externalId}` : `wa:${instance.id}:update:${ev.externalId}:${ev.status}`;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Sem texto, telefone ou token: só o necessário para auditoria/idempotência.
          await tx.webhookEvent.create({
            data: { source: SOURCE, eventId, processedAt: now, payload: { kind: ev.kind, instance: ev.instanceName, externalId: ev.externalId } },
          });
          if (ev.kind === "message_status") {
            await applyMessageStatus(tx, instance.id, ev);
            return "status";
          }
          const r = await processInbound(tx, instance, ev, now);
          if (r.status === "lead_not_found") {
            log(`lead não encontrado para mensagem recebida (instância=${ev.instanceName}); ignorada`);
            return "lead_not_found";
          }
          return r.kind;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") return "duplicate"; // eventId já processado
        if (e.code === "P2034" && attempt < MAX_TX_ATTEMPTS) continue;
      }
      throw e;
    }
  }
}

/**
 * Receiver do webhook do WhatsApp (SPEC-012). Ordem: formato do token -> instância pelo token -> verify (tempo constante + apikey opcional)
 * -> rate limit (global/token) -> parseWebhook (400) -> conferência de instância -> processamento no banco. Sem chamada externa síncrona.
 */
export async function handleWhatsAppWebhook(request: Request, token: string, opts: HandlerOptions = {}): Promise<Response> {
  const now = opts.now ?? new Date();
  try {
    if (!TOKEN_RE.test(token)) {
      const wait = invalidAttemptRetry(now.getTime());
      return wait === null ? unauthorized() : tooManyRequests(wait);
    }
    const instance = await prisma.whatsAppInstance.findUnique({ where: { webhookToken: token } });
    if (!instance) {
      const wait = invalidAttemptRetry(now.getTime());
      return wait === null ? unauthorized() : tooManyRequests(wait);
    }
    const provider = opts.provider ?? getWhatsAppProvider(instance.provider);
    let apiKey: string | null = null;
    if (instance.apiKey) {
      try { apiKey = decrypt(instance.apiKey); } catch { log(`apiKey da instância ${instance.instanceName} ilegível; 2º fator ignorado`); }
    }
    if (!(await provider.verifyWebhook(request, { webhookToken: instance.webhookToken, apiKey }, token))) return unauthorized();

    const wait = validTrafficRetry(token, now.getTime());
    if (wait !== null) return tooManyRequests(wait);

    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "payload_too_large", message: "Corpo da requisição grande demais." });

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
    return ok(await persist(instance, event, now));
  } catch (e) {
    console.error("[whatsapp-webhook] erro:", redactWebhookToken(safeErrorForLog(e)));
    return json(500, { error: "internal_error", message: "Não foi possível processar o webhook." });
  }
}
