import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook-handler";

/**
 * Rota PÚBLICA (o proxy exclui /api/webhooks): a autenticação é o token por instância no caminho da URL.
 * `[[...evento]]` absorve o sufixo que o Evolution anexa com webhook_by_events (ex.: /messages-upsert); é ignorado.
 * Só POST; demais métodos recebem 405 do Next (não exportados). O token nunca é logado.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; evento?: string[] }> }): Promise<Response> {
  const { token } = await ctx.params;
  return handleWhatsAppWebhook(req, token);
}
