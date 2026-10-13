import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, NEW_LIMIT_KEYS } from "./plan-catalog";

/**
 * SPEC-069b (AC-5) — TESTE DE COBERTURA no padrao `*-auth-coverage.test.ts`: falha se um novo ponto de entrada de servidor (Server Action, Route
 * Handler, job do tick) nao for classificado, se um ponto classificado como "guardado" deixar de chamar o modulo `entitlements`, se uma funcionalidade/limite
 * do catalogo nao for aplicado em lugar nenhum, ou se alguem comparar `plan.key` fora do catalogo/modulo. Para um novo ponto de entrada: acrescente-o
 * ao manifesto abaixo com `guard`, `via` ou `exempt` + MOTIVO (revisado no code review).
 */
const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
const isProd = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);

/** Chamadas que passam pelo modulo unico (direto ou pelo wrapper de limites legados, que e derivado de `getEntitlements`). */
const ENT_CALL = /\b(assertFeature|assertFeatureIn|assertWithinEntitlementLimit|assertWithinLimit|assertCanActivateCampaign|getEntitlements|getOrgLimits|hasFeature|isCostlyBlocked|resolveRunnableAgents|runnableAgentIds|inboxReadGuard)\b/;

type Spec = { guard: true } | { via: string } | { exempt: string };
const G: Spec = { guard: true };
const via = (file: string): Spec => ({ via: file });
const ex = (reason: string): Spec => ({ exempt: reason });

/** Funcao exportada de um arquivo: nome -> corpo (ate o proximo `export`). */
export function exportedFunctions(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^export (?:async )?function ([A-Za-z0-9_]+)/gm;
  const marks = [...src.matchAll(re)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  const exportsAt = [...src.matchAll(/^export /gm)].map((m) => m.index ?? 0);
  for (const m of marks) {
    const next = exportsAt.find((p) => p > m.at) ?? src.length;
    out[m.name] = src.slice(m.at, next);
  }
  return out;
}

// -------------------------------------------------------------------------------------------------------------------------------
// 1) Server Actions
// -------------------------------------------------------------------------------------------------------------------------------
const ACTIONS: Record<string, Record<string, Spec>> = {
  "src/lib/actions/agent.ts": {
    createAgent: G, updateAgent: ex("edita CONTEUDO (persona/tom/objetivo); a POLITICA (modelo/teto/msgs/turnos) e recusada para o tenant (069c, coberto na secao 7); sem custo. Ativar e mudar autonomia sao barrados; o runner reaplica o plano (min() do plano)"),
    setAgentActive: G, setAgentAutonomy: G, updateAgentSettings: G,
    saveKnowledge: ex("base de conhecimento e conteudo do cliente; sem custo nem envio"), deleteKnowledge: ex("limpeza de conteudo"),
    simulateAgentAction: G, getAgentUsage: ex("leitura de uso"), getAgentRuns: ex("leitura de historico"),
    approveDraft: via("src/lib/agents/drafts.ts"), rejectDraftAction: ex("rejeitar nunca envia nem gasta; sempre liberado"), bulkApproveFollowups: G,
    takeOverLead: ex("assumir a conversa PARA o agente (reduz custo); sempre liberado"),
  },
  "src/lib/actions/integration.ts": { saveIntegration: G, removeIntegration: ex("limpeza de chave; sempre liberado (downgrade nao prende segredo)"), testIntegration: G },
  "src/lib/actions/lead-source.ts": { saveLeadSourceBinding: G, removeLeadSourceBinding: ex("limpeza de vinculo; sempre liberado") },
  "src/lib/actions/inbox.ts": {
    sendManualMessage: via("src/lib/inbox/send-manual.ts"), markConversationRead: ex("marcar como lida e leitura (Free le)"), setConversationStatus: G,
  },
  "src/lib/actions/creative.ts": {
    createCreativeDraft: via("src/lib/creatives/service.ts"), submitCreative: via("src/lib/creatives/service.ts"), retryCreative: via("src/lib/creatives/service.ts"),
    cancelCreative: ex("cancelar reduz custo"), deleteCreative: ex("limpeza (soft delete); nao devolve cota"), listCreatives: ex("leitura"), getCreative: ex("leitura"),
    getCreativeVideoUrl: ex("leitura"), listAvatarsAndVoices: ex("catalogo de leitura"),
  },
  "src/lib/actions/org.ts": {
    listMyOrganizations: ex("leitura"), switchActiveOrganization: ex("troca de org ativa; sem efeito de plano"), listMembers: ex("leitura"),
    inviteMember: G, revokeInvite: ex("revogar libera vaga"), acceptInvite: via("src/lib/org/join.ts"), joinByCode: via("src/lib/org/join.ts"),
    generateJoinCode: ex("o codigo so gera entrada via joinWithCode (guardado em join.ts)"), disableJoinCode: ex("reduz acesso"),
    changeMemberRole: ex("nao altera a contagem de membros"), removeMember: ex("remover libera vaga"), leaveOrganization: ex("sair libera vaga"),
    previewInvite: ex("leitura publica do convite"), signUpAndJoin: via("src/lib/org/join.ts"),
  },
  "src/lib/actions/sequence.ts": {
    createSequence: G, renameSequence: ex("renomear nao muda passos"), saveSequenceSteps: G, reorderSteps: ex("permutacao: mesma quantidade de passos"),
    duplicateSequence: G, deleteSequence: ex("limpeza"),
  },
  "src/lib/actions/lead-search.ts": { searchLeads: via("src/lib/lead-search/run.ts"), getSearchRunStatus: ex("leitura") },
  "src/lib/actions/email.ts": {
    createEmailAccount: G, updateEmailAccount: ex("edicao de conta existente"), deleteEmailAccount: ex("limpeza"), setActive: ex("alternar conta existente"), testEmailConnection: ex("teste de conexao SMTP, sem envio de mensagem"),
  },
  "src/lib/actions/whatsapp.ts": {
    createWhatsAppInstance: G, getInstanceQr: ex("pareamento de numero existente"), refreshInstanceStatus: ex("leitura de estado"), updateInstance: ex("edicao de numero existente"),
    deleteWhatsAppInstance: ex("limpeza"), disconnectInstance: ex("reduz acesso"), getInstanceWebhookConfig: ex("leitura"), rotateWebhookToken: ex("gira segredo existente"),
    confirmOptOut: ex("protecao do contato"), dismissPossibleOptOut: ex("alerta"),
  },
  "src/lib/actions/campaign.ts": {
    createCampaign: G, updateCampaign: via("src/lib/billing/limits.ts"), pauseCampaign: ex("pausar reduz uso"), resumeCampaign: via("src/lib/billing/limits.ts"),
    archiveCampaign: ex("arquivar reduz uso"), duplicateCampaign: ex("a copia nasce PAUSADA; ativar passa por resumeCampaign -> assertCanActivateCampaign"), deleteCampaign: ex("limpeza"),
  },
  "src/lib/actions/sequence-start.ts": {
    startSequence: ex("agenda toques; o ENVIO passa por reserve.ts (deferOverPlanBeforeReserve: past_due/plano ilegivel/maxSendsPerDay)"),
    startCampaignSequences: ex("idem startSequence"), stopSequence: ex("parar reduz uso"),
  },
};

/** Arquivos de actions FORA do escopo da 069b (sem agentes/integracoes/busca/fontes/caixa/criativos/equipe/sequencias/envio), com motivo. */
const EXEMPT_ACTION_FILES: Record<string, string> = {
  "src/lib/actions/account-deletion.ts": "exclusao de conta/LGPD",
  "src/lib/actions/auth.ts": "autenticacao",
  "src/lib/actions/billing.ts": "cobranca/assinatura (tem o proprio gate de checkout; 069 nao muda precos)",
  "src/lib/actions/icp.ts": "perfil de cliente ideal (conteudo)",
  "src/lib/actions/lead.ts": "CRUD de leads (cota de leads por mes ja no createLeadCore/getOrgLimits)",
  "src/lib/actions/meeting-search.ts": "reunioes (liberadas em todos os planos)",
  "src/lib/actions/meeting.ts": "reunioes (liberadas em todos os planos)",
  "src/lib/actions/pipeline.ts": "funil (liberado em todos os planos)",
  "src/lib/actions/result.ts": "utilitarios de resultado de action (nao sao actions)",
  "src/lib/actions/suppression.ts": "lista de supressao (protecao do contato)",
  "src/lib/actions/template.ts": "templates (liberados em todos os planos)",
  "src/lib/actions/whatsapp-health.ts": "saude/retomada de numero existente; o envio passa por reserve.ts",
};

describe("cobertura 069b: Server Actions", () => {
  const files = walk("src/lib/actions").filter((f) => isProd(f) && !f.includes("/admin/"));

  it("todo arquivo de actions esta classificado (escopo ou isento com motivo)", () => {
    const unknown = files.filter((f) => !(f in ACTIONS) && !(f in EXEMPT_ACTION_FILES));
    expect(unknown, `Classifique no manifesto de entitlements-coverage.test.ts: ${unknown.join(", ")}`).toEqual([]);
    for (const [f, reason] of Object.entries(EXEMPT_ACTION_FILES)) expect(reason.length, f).toBeGreaterThan(5);
  });

  for (const [file, specs] of Object.entries(ACTIONS)) {
    describe(file, () => {
      const fns = exportedFunctions(read(file));
      it("toda funcao exportada esta classificada (nova action sem guard/isencao FALHA)", () => {
        expect(Object.keys(fns).sort()).toEqual(Object.keys(specs).sort());
      });
      for (const [name, spec] of Object.entries(specs)) {
        it(`${name}: ${"guard" in spec ? "chama o modulo entitlements" : "via" in spec ? `delega a ${spec.via}` : `isenta (${spec.exempt.slice(0, 40)}...)`}`, () => {
          if ("guard" in spec) expect(fns[name], `${name} sem chamada ao modulo entitlements`).toMatch(ENT_CALL);
          else if ("via" in spec) {
            expect(fns[name], `${name} nao chama a funcao de dominio guardada`).toBeTruthy();
            expect(read(spec.via), `${spec.via} nao aplica entitlements`).toMatch(ENT_CALL);
          } else expect(spec.exempt.trim().length).toBeGreaterThan(5);
        });
      }
    });
  }

  it("auto-teste do detector: uma action nova SEM guard e identificada", () => {
    const fake = `export async function danger() { return 1; }\nexport async function safe() { await assertFeature(db, o, "x"); }`;
    const fns = exportedFunctions(fake);
    expect(ENT_CALL.test(fns.danger)).toBe(false);
    expect(ENT_CALL.test(fns.safe)).toBe(true);
    expect(Object.keys(fns).sort()).toEqual(["danger", "safe"]);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// 2) Route Handlers
// -------------------------------------------------------------------------------------------------------------------------------
const MOBILE = "app movel fora de manutencao (SPECs 021-023); as acoes de dominio que usa (dispatchDraft, startLeadSearch, activateCampaignWithinLimit) ja sao guardadas";
const ROUTES: Record<string, Spec> = {
  "src/app/api/inbox/conversations/route.ts": via("src/lib/inbox/http.ts"),
  "src/app/api/inbox/conversations/[id]/route.ts": via("src/lib/inbox/http.ts"),
  "src/app/api/inbox/conversations/[id]/messages/route.ts": via("src/lib/inbox/http.ts"),
  "src/app/api/inbox/unread-count/route.ts": via("src/lib/inbox/http.ts"),
  "src/app/api/integrations/leads/route.ts": via("src/lib/lead-ingest/handler.ts"),
  "src/app/api/integrations/leads/google-ads/route.ts": via("src/lib/lead-source/ingest.ts"),
  "src/app/api/integrations/leads/meta/route.ts": via("src/lib/lead-source/meta-handler.ts"),
  "src/app/api/integrations/meetings/route.ts": ex("reunioes (liberadas em todos os planos)"),
  "src/app/api/billing/webhook/route.ts": ex("webhook de cobranca (nao e uso de funcionalidade)"),
  "src/app/api/cron/tick/route.ts": ex("tick: cada job passa por seu proprio gate (processAgentQueue, processCreativeJobs, runDailySearch e reserve.ts), cobertos nos testes de dominio abaixo"),
  "src/app/api/notifications/route.ts": ex("notificacoes (leitura)"),
  "src/app/api/notifications/[id]/read/route.ts": ex("notificacoes (leitura)"),
  "src/app/api/notifications/read-all/route.ts": ex("notificacoes (leitura)"),
  "src/app/api/notifications/summary/route.ts": ex("notificacoes (leitura)"),
  "src/app/api/openapi/route.ts": ex("documentacao"),
  "src/app/api/storage/files/route.ts": ex("armazenamento (cota propria da SPEC-050)"),
  "src/app/api/storage/files/[id]/route.ts": ex("armazenamento (cota propria da SPEC-050)"),
  "src/app/api/storage/files/[id]/url/route.ts": ex("armazenamento (cota propria da SPEC-050)"),
  "src/app/api/storage/local/route.ts": ex("armazenamento local (dev)"),
  "src/app/api/webhooks/unsubscribe/[token]/route.ts": ex("descadastro (protecao do contato)"),
  "src/app/api/webhooks/whatsapp/[token]/[[...evento]]/route.ts": ex("RECEBER mensagens e leitura da caixa; o agente Closer inbound so e enfileirado por findActiveCloser (guardado)"),
};
for (const f of walk("src/app/api/mobile")) if (f.endsWith("route.ts")) ROUTES[f] = ex(MOBILE);

describe("cobertura 069b: Route Handlers", () => {
  const routes = walk("src/app/api").filter((f) => f.endsWith("/route.ts"));
  it("todo route handler esta classificado (novo handler sem guard/isencao FALHA)", () => {
    expect(routes.filter((r) => !(r in ROUTES)), "classifique no manifesto").toEqual([]);
    expect(Object.keys(ROUTES).filter((r) => !routes.includes(r)), "entrada de manifesto sem arquivo").toEqual([]);
  });
  for (const [file, spec] of Object.entries(ROUTES)) {
    if ("via" in spec) {
      it(`${file} -> ${spec.via} aplica entitlements`, () => {
        expect(read(spec.via)).toMatch(ENT_CALL);
      });
    }
  }
});

// -------------------------------------------------------------------------------------------------------------------------------
// 3) Gates de dominio (tick/runner, envio, equipe, busca, criativos, fontes)
// -------------------------------------------------------------------------------------------------------------------------------
const DOMAIN_GATES: Record<string, string> = {
  "src/lib/agents/run-agent.ts": "runner de agentes (fail-closed em IA e envio; teto de IA; msgs/dia; autonomia)",
  "src/lib/agents/queue.ts": "fila do tick (resolve o plano por org, sem N+1)",
  "src/lib/agents/drafts.ts": "ponto unico de envio de agentes (dispatchDraft)",
  "src/lib/agents/simulate.ts": "simulacao (gasta tokens)",
  "src/lib/agents/plan-gate.ts": "regras puras de agentes executaveis",
  "src/lib/creatives/service.ts": "limite mensal de criativos (sob lock da org)",
  "src/lib/creatives/runner.ts": "runner de criativos (nao cria video no provedor sem direito)",
  "src/lib/org/join.ts": "funil unico de entrada de membros (maxMembers)",
  "src/lib/lead-search/run.ts": "busca de leads (manual e agendada; maxLeadSearchesPerDay)",
  "src/lib/channels/reserve.ts": "ponto unico de envio (past_due/plano ilegivel/maxSendsPerDay)",
  "src/lib/lead-source/ingest.ts": "ingestao Google Ads/Meta (sources.ads)",
  "src/lib/lead-source/meta-handler.ts": "Meta: barra antes de chamar a Graph API",
  "src/lib/lead-ingest/handler.ts": "ingestao n8n/API (ingest.api)",
  "src/lib/inbox/send-manual.ts": "resposta manual da caixa (inbox.reply)",
  "src/lib/inbox/http.ts": "leitura da caixa (inbox.read)",
  "src/lib/billing/limits.ts": "limites legados (campanhas, whatsapp, e-mail, leads, envios/dia) derivados do modulo",
};
describe("cobertura 069b: gates de dominio / tick", () => {
  for (const [file, why] of Object.entries(DOMAIN_GATES)) {
    it(`${file} chama o modulo entitlements (${why})`, () => {
      expect(read(file)).toMatch(ENT_CALL);
    });
  }
  it("o gate de envio e o ponto unico: sendEmail e sendWhatsApp passam por deferOverPlanBeforeReserve", () => {
    for (const f of ["src/lib/channels/email.ts", "src/lib/channels/whatsapp.ts"]) expect(read(f)).toContain("deferOverPlanBeforeReserve(");
  });
  it("dispatchDraft e o unico caminho de envio de agente (runner e aprovacao passam por ele)", () => {
    expect(read("src/lib/agents/run-agent.ts")).toContain("dispatchDraft(");
    expect(read("src/lib/actions/agent.ts")).toContain("dispatchDraft(");
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// 4) Todo item do catalogo e APLICADO em algum lugar
// -------------------------------------------------------------------------------------------------------------------------------
describe("cobertura 069b: catalogo x aplicacao", () => {
  const MODULE_FILES = ["src/lib/billing/plan-catalog.ts", "src/lib/billing/entitlements.ts", "src/lib/billing/plans.ts"];
  const consumers = [...walk("src/lib"), ...walk("src/app")].filter((f) => isProd(f) && !MODULE_FILES.includes(f));
  const corpus = consumers.map((f) => read(f)).join("\n");
  /** Features ainda sem ponto de entrada porque o recurso nao existe (SPECs futuras): ao nascer, o teste exige remover da lista e aplicar. */
  const PENDING: Record<string, string> = { "inbox.attachments": "anexos da caixa (SPEC-068c/d)", "inbox.labels": "etiquetas da caixa (SPEC-068e)" };

  it("toda funcionalidade do catalogo e aplicada fora do modulo (ou esta na lista de pendentes com SPEC)", () => {
    const helpers: Record<string, RegExp> = { "agents.role.": /agentRoleFeature\(/, "agents.autonomy.": /agentAutonomyFeature\(/ };
    const missing = FEATURE_KEYS.filter((k) => {
      if (k in PENDING) return false;
      if (corpus.includes(`"${k}"`)) return false;
      const h = Object.entries(helpers).find(([p]) => k.startsWith(p));
      return !(h && h[1].test(corpus));
    });
    expect(missing, "funcionalidade do catalogo sem ponto de aplicacao").toEqual([]);
    for (const k of Object.keys(PENDING)) expect(corpus.includes(`"${k}"`), `${k} passou a ser usada: remova de PENDING`).toBe(false);
  });

  it("todo limite numerico do catalogo e aplicado (por chave ou pela metrica de assertWithinEntitlementLimit)", () => {
    const METRIC: Record<string, string> = { maxActiveAgents: "agents", maxAiBudgetCentsMonth: "ai_budget", maxAgentMessagesPerDay: "agent_messages", maxLeadSearchesPerDay: "lead_searches", maxCreativesPerMonth: "creatives", maxMembers: "members", maxSequenceSteps: "sequence_steps" };
    const missing = NEW_LIMIT_KEYS.filter((k) => !new RegExp(`\\b${k}\\b`).test(corpus) && !new RegExp(`assertWithinEntitlementLimit\\([^)]*"${METRIC[k]}"`).test(corpus));
    expect(missing).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// 5) Nenhum `plan.key ===` fora do catalogo/modulo (AC-5)
// -------------------------------------------------------------------------------------------------------------------------------
describe("cobertura 069b: nenhuma checagem por chave de plano fora do modulo/catalogo", () => {
  // Servidor inteiro (`src/lib`, `src/app/api`, paginas/layouts server `src/app/**`). Componentes de UI (`src/components`) sao da 069d.
  const ALLOWED = ["src/lib/billing/entitlements.ts", "src/lib/billing/plan-catalog.ts"];
  const KEY = /(?:\b(?:plan|subscription|sub)\.(?:plan\.)?key|\bplanKey|\.planKey)\s*[!=]==?\s*["'`](?:free|starter|pro|business|courtesy)["'`]|["'`](?:free|starter|pro|business|courtesy)["'`]\s*[!=]==?\s*(?:\w+\.)*(?:plan\.key|planKey)\b/;
  it("sem `plan.key === \"...\"` / `planKey === \"...\"` em src/lib, src/app", () => {
    const offenders = [...walk("src/lib"), ...walk("src/app")].filter((f) => isProd(f) && !ALLOWED.includes(f) && KEY.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it("auto-teste do detector", () => {
    expect(KEY.test('if (sub.plan.key === "pro") {}')).toBe(true);
    expect(KEY.test('x = planKey !== "free"')).toBe(true);
    expect(KEY.test('hasFeature(ent, "agents.role.sdr")')).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// 6) SPEC-069c: actions de ADMIN (politica por organizacao). Excluidas da secao 1 (sao do platform_admin, nao do tenant).
// -------------------------------------------------------------------------------------------------------------------------------
/** Toda action de `src/lib/actions/admin/entitlements.ts`: so `platform_admin` + nucleo que AUDITA (PlatformAuditLog + OrgAuditLog na mesma transacao). */
const ADMIN_POLICY_ACTIONS: Record<string, string> = {
  setOrgEntitlementOverride: "setOverride",
  clearOrgEntitlementOverride: "clearOverride",
  setOrgAgentSettingsByAdmin: "setOrgAgentSettings",
  setAgentPolicyByAdmin: "setAgentPolicy",
  saveOrgIntegrationByAdmin: "saveOrgIntegration",
  removeOrgIntegrationByAdmin: "removeOrgIntegration",
};
describe("cobertura 069c: actions de admin (politica por organizacao)", () => {
  const FILE = "src/lib/actions/admin/entitlements.ts";
  const CORE = "src/lib/admin/org-policy.ts";
  const fns = exportedFunctions(read(FILE));
  const core = exportedFunctions(read(CORE));

  it("todo arquivo em src/lib/actions/admin esta classificado (novo arquivo sem classificacao FALHA)", () => {
    const files = walk("src/lib/actions/admin").filter(isProd).sort();
    expect(files).toEqual(["src/lib/actions/admin/entitlements.ts", "src/lib/actions/admin/organizations.ts"]);
  });
  it("toda funcao exportada esta no manifesto (nova action de admin sem manifesto/auditoria FALHA)", () => {
    expect(Object.keys(fns).sort()).toEqual(Object.keys(ADMIN_POLICY_ACTIONS).sort());
  });
  for (const [action, coreFn] of Object.entries(ADMIN_POLICY_ACTIONS)) {
    it(`${action}: requirePlatformAdmin ANTES de tudo, nunca requireProviderOrg/scopedPrisma, delega a ${coreFn} que AUDITA`, () => {
      const body = fns[action];
      expect(body, action).toMatch(/await requirePlatformAdmin\(\)/);
      expect(body).not.toMatch(/requireProviderOrg|requireActiveProviderOrg|requireOrgOwner|scopedPrisma/);
      expect(body).toContain(`${coreFn}(user.id`);
      expect(core[coreFn], `${coreFn} sem auditoria`).toMatch(/\baudit\(tx/);
      expect(core[coreFn], `${coreFn} exige motivo (schema)`).toMatch(/Schema\.safeParse/);
    });
  }
  it("o nucleo nao e uma Server Action (sem \"use server\") e nao vaza segredo na auditoria (meta so com host mascarado/nomes)", () => {
    const src = read(CORE);
    expect(src).not.toMatch(/^"use server"/m);
    const auditCalls = src.match(/audit\(tx, \{[\s\S]*?\}\);/g) ?? [];
    expect(auditCalls.length).toBeGreaterThanOrEqual(6);
    for (const c of auditCalls) expect(c, "auditoria nao pode citar value/hint/encryptedValue").not.toMatch(/\bvalue\b\s*[:,}]|encryptedValue|hint:/);
  });
  it("a escrita de override/politica so existe no nucleo do admin: nenhuma action de tenant escreve orgEntitlementOverride (lockedByAdmin: teste comportamental em entitlements-069c.test.ts)", () => {
    const offenders = [...walk("src/lib"), ...walk("src/app")].filter((f) => isProd(f) && f !== CORE && /orgEntitlementOverride\.(create|upsert|update|delete)/.test(read(f)) && !f.includes("test-utils"));
    expect(offenders).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// 7) SPEC-069c: o tenant e SOMENTE LEITURA na politica; mobile aplica os mesmos guards da web (achados 1 e 2 do QA 069b)
// -------------------------------------------------------------------------------------------------------------------------------
describe("cobertura 069c: tenant somente leitura na politica + mobile", () => {
  const agent = exportedFunctions(read("src/lib/actions/agent.ts"));
  const integ = exportedFunctions(read("src/lib/actions/integration.ts"));
  for (const name of ["createAgent", "updateAgent"]) {
    it(`${name} recusa mudanca de politica (assertNoPolicyChange)`, () => expect(agent[name]).toContain("assertNoPolicyChange("));
  }
  it("updateAgentSettings recusa teto da org e desligar o kill switch travado (PolicyManagedByAdminError)", () => {
    expect(agent.updateAgentSettings).toContain("PolicyManagedByAdminError");
    expect(agent.updateAgentSettings).toContain("lockedByAdmin");
  });
  it("saveIntegration/removeIntegration recusam chave da plataforma (evolution/places/managedByPlatform)", () => {
    expect(integ.saveIntegration).toContain("PolicyManagedByAdminError");
    expect(integ.saveIntegration).toContain("PLATFORM_ONLY");
    expect(integ.removeIntegration).toContain("PolicyManagedByAdminError");
  });
  it("mobile: setKillSwitch aplica assertFeature + trava do admin e approveDraftMobile mapeia PlanFeatureLockedError (o manifesto nao isenta mais estes dois em bloco)", () => {
    const m = exportedFunctions(read("src/lib/mobile/actions.ts"));
    expect(m.setKillSwitch).toMatch(/assertFeature\(/);
    expect(m.setKillSwitch).toContain("lockedByAdmin");
    expect(m.approveDraftMobile).toContain("PlanFeatureLockedError");
    expect(m.approveDraftMobile).toContain("PlanLimitError");
  });
  it("a resolucao de LLM desativa a chave BYOK do tenant sem llm.byok (findIntegrationConfig)", () => {
    const src = read("src/lib/integrations/config.ts");
    expect(src).toContain("tenantKeyActive(");
    expect(src).toContain('"llm.byok"');
  });
});
