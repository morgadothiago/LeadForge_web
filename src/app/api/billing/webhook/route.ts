import { handleBillingWebhook } from "@/lib/billing/webhook-handler";

/**
 * Rota PÚBLICA (autenticação é a assinatura HMAC do provedor, `stripe-signature`, verificada dentro do
 * handler — igual ao padrão do webhook do WhatsApp, SPEC-012/017). Só POST; demais métodos recebem 405
 * do Next (não exportados).
 */
export async function POST(req: Request): Promise<Response> {
  return handleBillingWebhook(req);
}
