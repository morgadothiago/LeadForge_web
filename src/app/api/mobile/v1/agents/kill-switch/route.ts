import { readJson } from "@/lib/mobile/http";
import { mobileAction, setKillSwitch } from "@/lib/mobile/actions";
import { killSwitchSchema } from "@/lib/mobile/schemas";

export const dynamic = "force-dynamic";

/** SPEC-026: killSwitch=true para os agentes (sem atrito); killSwitch=false exige `password` (reautenticacao). Somente admin. */
export async function PUT(req: Request): Promise<Response> {
  const body = await readJson(req);
  const p = killSwitchSchema.safeParse(body);
  const action = p.success && !p.data.killSwitch ? "agents.kill_switch_off" : "agents.kill_switch_on";
  return mobileAction(req, {
    action, target: null,
    run: async (a) => (p.success ? setKillSwitch(a, p.data.killSwitch, p.data.password) : { ok: false, status: 400, code: "invalid_input", message: "Dados inválidos." }),
  });
}
