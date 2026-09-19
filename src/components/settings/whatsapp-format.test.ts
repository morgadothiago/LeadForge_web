import { describe, expect, it } from "vitest";
import { formatInstanceNumber, maskWebhookUrl, safeQrSrc } from "./whatsapp-format";

describe("whatsapp-format", () => {
  it("formata número BR e preserva desconhecido", () => {
    expect(formatInstanceNumber("+5511912345678")).toBe("(11) 91234-5678");
    expect(formatInstanceNumber("+1555")).toBe("+1555");
  });
  it("safeQrSrc aceita só PNG base64", () => {
    expect(safeQrSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(safeQrSrc("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeQrSrc("javascript:alert(1)")).toBeNull();
    expect(safeQrSrc('data:image/png;base64,AA"onerror="x')).toBeNull();
    expect(safeQrSrc("https://evil.test/a.png")).toBeNull();
    expect(safeQrSrc(null)).toBeNull();
  });
  it("mascara o token na URL", () => {
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const url = `https://app.test/api/webhooks/whatsapp/${token}`;
    expect(maskWebhookUrl(url, token)).toBe("https://app.test/api/webhooks/whatsapp/…DEFG");
    expect(maskWebhookUrl(url, "")).not.toContain(token);
  });
});
