import { notFound } from "next/navigation";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";

/**
 * SPEC-069f (D-069-12 / Q-069-12): as integracoes (Places, WhatsApp/Evolution, IA e fontes de leads) sao do `platform_admin` (Admin > Organizacoes);
 * o cliente apenas USA o servico. A aba "Integracoes" saiu das Configuracoes do cliente e esta rota responde 404 para todos (o `platform_admin`
 * nao tem organizacao e gerencia por `/admin/organizacoes/[id]`). Pareamento de numero de WhatsApp (QR) continua em /configuracoes/whatsapp.
 * As actions de integracao seguem protegidas no servidor (`requireActiveProviderOrg` + `assertFeature` + `PLATFORM_ONLY`).
 */
export default async function Page(): Promise<never> {
  await redirectIfTrialExpired(); // varredura do SPEC-065 (D-065-13): toda page de (app) tem guard; trial expirado redireciona antes do 404
  notFound();
}
