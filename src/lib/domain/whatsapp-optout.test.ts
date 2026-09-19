import { describe, expect, it } from "vitest";
import { classifyInboundText, normalizeInboundText, OPT_OUT_EXACT } from "./whatsapp-optout";
import { pickLead } from "./whatsapp-inbound";

describe("normalizeInboundText", () => {
  it("minúsculas, sem acento/pontuação/emoji, trim e espaços colapsados", () => {
    expect(normalizeInboundText("  Não   QUERO!!! 🙏 ")).toBe("nao quero");
    expect(normalizeInboundText("Sair!")).toBe("sair");
    expect(normalizeInboundText("🙏")).toBe("");
  });
});

describe("classifyInboundText: opt-out exato (D18)", () => {
  it.each(["PARAR", "Parar.", "Não quero", "nao quero mais", "  Sair! ", "STOP", "pare 🙏", "Descadastrar", "Cancelar!!", "remover", "Não tenho interesse", "NÃO  QUERO  MAIS 😕"])(
    "%s -> opt_out", (t) => expect(classifyInboundText(t)).toBe("opt_out"),
  );
  it("toda a lista é reconhecida", () => {
    for (const w of OPT_OUT_EXACT) expect(classifyInboundText(w)).toBe("opt_out");
  });
  it.each(["nao quero parar de conversar", "quero sair para almoçar", "Pode parar na minha sala amanhã?", "Tenho interesse!", "não quero agora, mas depois sim", "ok", ""])(
    "falso positivo %j -> reply", (t) => expect(classifyInboundText(t)).toBe("reply"),
  );
});

describe("classifyInboundText: possível opt-out", () => {
  it.each(["Para de me mandar mensagem", "por favor NÃO ME ENVIE mais nada", "me tira da lista!", "quero remover meu número", "Não tenho interesse em receber isso", "não me mande mais"])(
    "%s -> possible_opt_out", (t) => expect(classifyInboundText(t)).toBe("possible_opt_out"),
  );
  it("não casa por substring de palavra", () => {
    expect(classifyInboundText("desnao me envie")).toBe("reply");
  });
});

describe("pickLead", () => {
  const d = (n: number) => new Date(2026, 0, n);
  const c = (id: string, over = {}) => ({ id, createdAt: d(1), sequenceStatus: "completed", campaignInstanceId: null as string | null, lastSentByInstance: null as Date | null, ...over });
  it("null sem candidatos", () => expect(pickLead([], "i1")).toBeNull());
  it("prioriza relação com a instância, depois sequência ativa, depois contato mais recente", () => {
    expect(pickLead([c("a"), c("b", { campaignInstanceId: "i1" })], "i1")?.id).toBe("b");
    expect(pickLead([c("a", { campaignInstanceId: "i1" }), c("b", { campaignInstanceId: "i1", sequenceStatus: "active" })], "i1")?.id).toBe("b");
    expect(pickLead([c("a", { lastSentByInstance: d(2) }), c("b", { lastSentByInstance: d(5) })], "i1")?.id).toBe("b");
    expect(pickLead([c("a", { campaignInstanceId: "outra" }), c("b", { createdAt: d(9) })], "i1")?.id).toBe("b");
  });
});
