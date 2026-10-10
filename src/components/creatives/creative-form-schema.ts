import { createCreativeDraftSchema } from "@/lib/schemas/creative";

/**
 * SPEC-051b — schema do formulário em passos: o do servidor (`createCreativeDraftSchema`) + tetos que variam por env
 * (`limits` vindos de `listAvatarsAndVoices`). O servidor continua sendo a fonte de verdade (revalida tudo).
 */
export function buildCreativeFormSchema(limits: { maxScriptChars: number }) {
  return createCreativeDraftSchema.extend({
    script: createCreativeDraftSchema.shape.script.refine((s) => s.length <= limits.maxScriptChars, {
      message: `Roteiro muito longo (máx. ${limits.maxScriptChars} caracteres).`,
    }),
  });
}
