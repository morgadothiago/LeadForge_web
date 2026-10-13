import { getAiBudgetAlert } from "@/lib/queries/entitlements";
import { AiBudgetNotice } from "./AiBudgetNotice";

/** SPEC-069d — faixa global (so proprietario; so 80%/100% do teto de IA do plano). Falha de consulta nunca derruba o layout. */
export async function AiBudgetBanner() {
  let budget = null;
  try {
    budget = await getAiBudgetAlert();
  } catch {
    return null;
  }
  return budget ? <AiBudgetNotice budget={budget} variant="banner" /> : null;
}
