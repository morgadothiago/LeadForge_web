import { previewAccountDeletionToken } from "@/lib/actions/account-deletion";
import { DELETION_WINDOW_DAYS } from "@/lib/account-deletion/constants";
import { getFormError } from "@/components/campaigns/form-utils";
import type { DeletionLandingState } from "./DeletionTokenLanding";

/** Decodifica o segmento da URL e decide o estado da pagina publica (`want` = tipo de link esperado pela rota). */
export async function loadDeletionLandingState(rawToken: string, want: "confirm" | "cancel"): Promise<{ token: string; state: DeletionLandingState }> {
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    /* mantem o valor bruto */
  }
  const p = await previewAccountDeletionToken({ token });
  if (!p.ok) return { token, state: { kind: "error", message: getFormError(p.errors, "Não foi possível abrir o link agora. Tente novamente em instantes.") } };
  if (!p.data.valid || p.data.kind !== want) return { token, state: { kind: "invalid" } };
  if (p.data.kind === "confirm") return { token, state: { kind: "confirm", expiresAt: p.data.expiresAt, windowDays: DELETION_WINDOW_DAYS } };
  return { token, state: { kind: "cancel", scheduledFor: p.data.scheduledFor } };
}
