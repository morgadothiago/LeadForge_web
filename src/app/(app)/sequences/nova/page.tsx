import { SequenceBuilder } from "@/components/sequences/SequenceBuilder";
import { loadTemplateOptions } from "@/components/sequences/load-options";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const templates = await loadTemplateOptions();
  return <SequenceBuilder mode="create" templates={templates} />;
}
