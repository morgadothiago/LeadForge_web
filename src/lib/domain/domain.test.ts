import { describe, expect, it } from "vitest";
import { Channel, Stage } from "@prisma/client";
import { CHANNELS, CHANNEL_COLORS, STAGES, STAGE_COLORS, STAGE_LABELS } from "./index";

describe("domain", () => {
  it("cobre os 7 stages e 4 canais do schema", () => {
    expect([...STAGES].sort()).toEqual(Object.values(Stage).sort());
    expect([...CHANNELS].sort()).toEqual(Object.values(Channel).sort());
    for (const s of STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
      /** SPEC-037 (correção QA): valor é `var(--stage-*)`, não hex literal — lê o token CSS
       * recalculado por tema em vez de fixar sempre a mesma cor independente do modo ativo. */
      expect(STAGE_COLORS[s]).toMatch(/^var\(--stage-[\w-]+\)$/);
    }
    for (const c of CHANNELS) expect(CHANNEL_COLORS[c]).toMatch(/^var\(--channel-[\w-]+\)$/);
  });
});
