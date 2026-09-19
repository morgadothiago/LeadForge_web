import { describe, expect, it } from "vitest";
import { normalizeBrPhone } from "./phone";

describe("normalizeBrPhone", () => {
  it.each([
    ["11912345678", "+5511912345678"],
    ["(11) 91234-5678", "+5511912345678"],
    ["+55 11 91234-5678", "+5511912345678"],
    ["5511912345678", "+5511912345678"],
    ["55 (21) 99999-0000", "+5521999990000"],
  ])("aceita %s", (i, o) => {
    expect(normalizeBrPhone(i)).toEqual({ ok: true, e164: o });
  });
  it.each(["", "1234", "1191234567", "1131234567", "01912345678", "119123456789", "abc", "+1 415 555 2671", "5511812345678"])(
    "rejeita %s",
    (i) => {
      const r = normalizeBrPhone(i);
      expect(r.ok).toBe(false);
    },
  );
});
