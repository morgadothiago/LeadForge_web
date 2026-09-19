import { describe, expect, it } from "vitest";
import { replyLabel, truncateInbound } from "./reply-format";

describe("reply-format", () => {
  it("trunca e colapsa espaços, sem interpretar HTML", () => {
    expect(truncateInbound("  oi   tudo\nbem ")).toBe("oi tudo bem");
    const t = truncateInbound("<b>" + "a".repeat(200), 20);
    expect(Array.from(t)).toHaveLength(20);
    expect(t.endsWith("…")).toBe(true);
    expect(t.startsWith("<b>")).toBe(true);
  });
  it("rótulo relativo", () => {
    const now = new Date("2026-09-19T15:00:00Z");
    expect(replyLabel(new Date("2026-09-19T13:00:00Z"), now).relative).toBe("Respondeu há 2 horas");
  });
});
