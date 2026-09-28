# LeadForge — Indice de SPECs (SDD)
SPECs 000-008 APPROVED (usuario, 2026-09-19); todas APPROVED (014, 015, 019 com defaults conservadores, revisaveis). Aprovar com `APROVAR SPEC-XXX`. Uma SPEC por vez, na ordem. Toda SPEC de codigo Next 16: ler `node_modules/next/dist/docs/` antes (AGENTS.md).
Fullstack = executa dev-backend primeiro, depois dev-frontend.

| SPEC | Feature | Agente | Sessao | Status | Depende de |
|---|---|---|---|---|---|
| 000 | Setup, versoes, deps, docker, env, prisma.ts | dev-backend | 1 | IMPLEMENTED | - |
| 001 | Schema Prisma corrigido + seed | dev-backend | 1 | IMPLEMENTED | 000 |
| 002 | Design system | dev-frontend | 1 | IMPLEMENTED (validacao visual pendente) | 000 |
| 003 | Layout base | dev-frontend | 1 | IMPLEMENTED (validacao visual pendente) | 002 |
| 004 | Dashboard | backend+frontend | 1 | IMPLEMENTED (validacao visual pendente) | 001,003 |
| 005 | Campanhas + ICP | backend+frontend | 1 | IMPLEMENTED (validacao visual pendente) | 001,003 |
| 006 | Sequences + Templates | backend+frontend | 1 | IMPLEMENTED (E2E/visual pendentes) | 001,003,005 |
| 007 | Pipeline Kanban | backend+frontend | 1 | IMPLEMENTED (teclado/rollback em navegador pendentes) | 001,003 |
| 008 | Leads (lista/detalhe) | backend+frontend | 1 | IMPLEMENTED (validacao visual pendente) | 001,003,007 |
| 009 | Autenticacao | backend+frontend | 2 (antecipar?) | IMPLEMENTED | 001,003 |
| 010 | Email Nodemailer | backend (+cfg UI) | 2 | IMPLEMENTED (SMTP real e visual pendentes) | 001,006,008 |
| 011 | WhatsApp Evolution | backend+frontend | 2 | IMPLEMENTED | 001,005 |
| 012 | Webhook receiver | dev-backend | 2 | IMPLEMENTED | 011 |
| 013 | Scheduler follow-up | dev-backend | 2 | IMPLEMENTED | 006,010,011,012 |
| 014 | Integracao n8n | dev-backend | 2/posterior | IMPLEMENTED | 013 |
| 017 | Politica de envio gentil + anti-banimento + supressao global | backend+frontend | 2 | IMPLEMENTED | 010,011,012 |
| 020 | Banco de dados separado para testes | infra/backend | 2 | IMPLEMENTED | 000,001 |
| 019 | Agentes de IA (SDR, Follow-up, Closer) configuraveis | backend+frontend | 3 (depois de 013 e 018) | IMPLEMENTED (backend+frontend; pendente QA e validacao em navegador) | 013,017,012,018 |
| 018 | Chaves de API e integracoes pelo painel (Configuracoes) | backend+frontend | 2 (depois de 017/013) | IMPLEMENTED | 009,010,011,016 |
| 016 | Erros HTTP/axios em PT-BR (prerequisito de 011-015) | dev-backend | 2 | IMPLEMENTED | 000 |
| 015 | Busca de leads por IA | backend+frontend | posterior | IMPLEMENTED (backend+frontend; e2e, cron e validacao em navegador pendentes) | 005,008,014 |
| 021 | Mobile: contrato /api/mobile/v1 + auth (access/refresh/revogacao) | dev-backend | 4 | IMPLEMENTED (backend; validacao em aparelho pendente) | 009 |
| 022 | Mobile: metricas do painel e saude (read-only) | dev-backend | 4 | IMPLEMENTED (backend; validacao em aparelho pendente) | 021 |
| 023 | Mobile: alertas + push (polling primeiro, Expo Push opcional) | dev-backend | 4 | IMPLEMENTED (backend; push real e validacao em aparelho pendentes) | 021,022 |
| 027 | Migracao da sidebar custom para shadcn `Sidebar` (icon-collapsible, cookie, Sheet mobile) | dev-frontend | 5 | IMPLEMENTED (2026-09-20; validacao visual pendente) | 003,009 |
| 028 | Reunioes: backend (Meeting, lembretes via alertas, resumo/leitura de notificacoes por sessao) | dev-backend | 5 | IMPLEMENTED (2026-09-21; backend; push real e migrate no banco de dev pendentes) | 001,007,012,013,019,023 |
| 029 | Calendario de reunioes + notificacoes (sino/Sheet, /notificacoes, bolinhas na sidebar, toasts, polling unico) | dev-frontend | 5 | IMPLEMENTED (2026-09-21; frontend; validacao visual/teclado/leitor de tela e migrate no banco de dev PENDENTES do usuario) | 028,027 |
| 030 | Migracao multi-tenant + ReBAC (Organization, orgId, guards, sessao com org/papel) | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-26; 6 rodadas dev-backend + 2 rodadas QA, ultima APPROVED) | - |
| 031 | Administrador: backend cross-tenant (listar/suspender/reativar Organizations) | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-26; 2 rodadas dev-backend + 2 rodadas QA, ultima APPROVED; flakiness pre-existente de meeting-reminders.test.ts corrigida) | 030 |
| 032 | Administrador: area cross-tenant (UI) | dev-frontend | 6 (SaaS) | IMPLEMENTED (2026-09-26; dev-frontend + QA APPROVED) | 031 |
| 033 | Billing/assinatura: backend (planos, checkout, webhook, gating) | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-26; 2 rodadas dev-backend + 2 rodadas QA, ultima APPROVED) | 030 |
| 034 | Billing/assinatura: frontend (pricing, checkout, signup self-service, gestao do plano) | dev-frontend | 6 (SaaS) | IMPLEMENTED (2026-09-26; dev-frontend + QA APPROVED) | 033 |
| 035 | Landing page publica ("/") | dev-frontend | 6 (SaaS) | IMPLEMENTED (2026-09-26; 2 rodadas dev-frontend + 4 rodadas QA, ultima APPROVED) | 002,027,034 (pricing/signup) |
| 036 | LLM gratuito (provedor OpenAI-compatible: Ollama, Gemini, Groq) | fullstack | 7 (LLM gratis) | DRAFT | 018,019,030 |
| 037 | Dark/Light mode + identidade visual unificada (landing+app+login) | dev-frontend | 6 (SaaS) | IMPLEMENTED (2026-09-26; 2 rodadas dev-frontend + 2 rodadas QA, ultima APPROVED) | 002,035 |
| 038 | Recuperacao de senha ("esqueci minha senha") | fullstack | 6 (SaaS) | IMPLEMENTED (2026-09-26; 2 rodadas backend + 1 frontend + 2 rodadas QA, ultima APPROVED) | 009,010,037 |
| 039 | Bloqueio manual de inadimplencia + lembretes de cobranca por e-mail | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-27; 2 rodadas dev-backend + 2 rodadas QA, ultima APPROVED) | 030,031,032,033,038 |
| 040 | Criacao manual de usuario com acesso completo (cortesia/interno) | fullstack | 6 (SaaS) | IMPLEMENTED (2026-09-27; backend+frontend + QA APPROVED) | 030,031,032,033 |
| 041 | Captacao de leads: Google Ads Lead Form + Meta Lead Ads | fullstack | 6 (SaaS) | IMPLEMENTED (2026-09-27; QA APPROVED) | 018,014,030 |
| 042 | Padrao react-hook-form + piloto (Auth: login/signup/esqueci-senha/redefinir-senha) | dev-frontend | 6 (SaaS) | IMPLEMENTED (2026-09-27; QA APPROVED) | 009,034,037,038 |
| 043 | react-hook-form: Campanhas, ICP, Leads | dev-frontend | 6 (SaaS) | APPROVED (usuario, 2026-09-27) | 042 |
| 044 | react-hook-form: Sequences, Templates, Agentes, Calendario | dev-frontend | 6 (SaaS) | APPROVED (usuario, 2026-09-27) | 042 |
| 045 | react-hook-form: Configuracoes, Integracoes, WhatsApp, Supressao, Admin, Billing | dev-frontend | 6 (SaaS) | APPROVED (usuario, 2026-09-27) | 042 |
| 046 | E-mail transacional: Resend (fallback SMTP) + templates HTML + 2 cenarios novos (assinatura efetuada/cancelada) | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-27; QA APPROVED) | 010,033,037,038,039,040 |
| 047 | AbacatePay como adapter adicional de PaymentProvider (PIX/cartao) | dev-backend | 6 (SaaS) | IMPLEMENTED (2026-09-27; QA APPROVED) | 033 |

Ordem (sessao 2): 009,010,016 feitos -> 011 -> 012 -> 017 -> 013 -> 014 -> 015. Ordem sessao 1: 000 -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 | 009 -> 010 -> 011 -> 012 -> 013 -> 014 -> 015.
Nota: 004 (dashboard) fica antes de 005-008 por ordem do PROMPT; com poucos dados usa seed.

## SaaS multi-tenant + billing + landing (sessao 6) — direcao do usuario 2026-09-25
Objetivo: transformar o LeadForge single-tenant em SaaS multi-tenant com assinatura, dois papeis via ReBAC: **Administrador** (superadmin, cross-tenant, vê e administra todos os Providers) e **Provider** (cliente assinante, usa o produto de hoje escopado ao proprio tenant). Ordem: 030 (base, bloqueia tudo) -> 031 -> 032 -> 033 -> 034; 035 (landing) pode comecar em paralelo do lado de hero/features assim que 002/027 estiverem de pé, mas a secao de Pricing só fecha depois de 034 e D-33-2 aprovada. Regra dura: nenhuma SPEC deste bloco altera `../mobile/` (schema, contrato `/api/mobile/v1`, specs mobile) — risco de quebra de contrato mobile fica sinalizado em cada SPEC, nunca resolvido alterando o lado mobile.
D-30-1..D-30-5 (SPEC-030) FECHADAS (usuario, 2026-09-25): D-30-1 role admin->platform_admin (sem org propria), role member->provider dono de Organization nova 1:1 | D-30-2 IcpProfile/Sequence/MessageTemplate/SequenceStep por-org, sem biblioteca global | D-30-3 policy layer proprio (sem CASL) | D-30-4 convite de multiplos membros fica para depois | D-30-5 teto agregado por org e principio aprovado, contador/enforcement fica na SPEC-033.
D-33-1..D-33-5 (SPEC-033) e D-35-1/D-35-2 (SPEC-035) FECHADAS (usuario, 2026-09-25): D-33-1 Stripe (provedor escolhido para quando existir integracao real) | D-33-2 3 tiers starter (R$297/mes) / pro (R$697/mes) / business (sob consulta, sem checkout self-service) — mensal/anual, **precos placeholder ate confirmacao antes do launch** | D-33-3 trial 14 dias sem cartao, grace period 7 dias em `past_due` antes de soft-block | D-33-4 soft-block imediato ao cancelar, retencao 90 dias, depois expurgo/anonimizacao automatizada (job incluido no escopo da SPEC-033) | **D-33-5 (2026-09-25): usuario ainda nao tem conta/meio de pagamento — integracao real do Stripe fica para depois. SPEC-033 implementa billing completo atras de uma interface `PaymentProvider` trocavel por env, rodando em modo `mock` por default; adapter Stripe fica stub pronto pra ativar quando houver conta/chaves.** | D-35-1 CTA "Comecar" -> `/signup` (signup self-service: cria User+Organization+trial, escopo movido para SPEC-034, nao vai para `/login`) | D-35-2 prova social omitida por enquanto, sem depoimento/logo fabricado. SPECs 031/032 (Administrador cross-tenant) seguem DRAFT, sem decisao pendente conhecida alem de aguardar SPEC-030 `IMPLEMENTED`.

## Decisoes aceitas (2026-09-19)
D1 Prisma 7.x estavel (CLI+client) | D2 DBs separados evolution/n8n | D3 enums | D5 vitest | D6 lead em 1 campanha | D9 ICP reutilizavel | D10 templates por campanha | D11 stage livre | D12 position no kanban | D13 sem CSV agora. D14 sessao propria jose+argon2, login e-mail/senha. D4 resposta WhatsApp move p/ interessado. D17 token por instancia na URL + rotacao. D18 opt-out por mensagem curta exata + alerta de possivel opt-out. Extra: WhatsApp via provider plugavel (SPEC-011).

## Decisoes pendentes (sessao 2)
D1 versao Prisma (7.x estavel p/ CLI e client, ou 8 rc p/ ambos) | D2 DBs separados p/ evolution/n8n | D3 enums vs String | D4 resposta move stage automaticamente? | D5 framework de testes (vitest) | D6 lead em 1 campanha | D8 "resposta"=Touch inbound | D9 ICP 1:1 ou N:1 | D10 templates por campanha ou globais | D11 transicoes de stage livres? | D12 ordem intra-coluna (position) | D13 importacao CSV | D14 auth (Auth.js/propria/nenhuma) e quando | D15 limite diario email | D16 deteccao resposta email | D17 auth do webhook | D18 regra de opt-out | D19 executor do scheduler | D20 papel do n8n | D21-23 busca IA (fontes, LLM, orcamento).

## Limitacoes de validacao
Docker parado: migrate, Evolution, n8n, SMTP nao verificaveis ponta a ponta; SPECs marcam esses criterios como PENDENTE.

## Regras transversais (usuario, 2026-09-19)
**HTTP de saida e rate limit (vale para SPECs 010-015 e qualquer cliente novo):**
- Todo cliente HTTP de saida (Evolution, n8n, provedor de busca/LLM, SMTP-API) usa UMA instancia axios por integracao, com interceptor de resposta que normaliza o erro (status, codigo, mensagem PT-BR, `retryAfter`) sem vazar corpo/headers/segredos.
- 429: respeitar `Retry-After` (segundos ou data HTTP); sem header, backoff exponencial com jitter e teto; maximo de tentativas; so repetir metodo idempotente ou com chave de idempotencia; nunca laco infinito. 5xx/timeout: retry limitado. 4xx (exceto 408/429): nao repetir.
- Endpoints proprios (Route Handlers, ex.: webhook SPEC-012) devolvem 429 + `Retry-After` ao limitar. Server Actions nao controlam status: devolver erro tipado em `ActionResult`.
- Testes obrigatorios por cliente: 429 com e sem `Retry-After`, tentativas esgotadas, 5xx, timeout, sem vazamento de segredo no erro.
- Onde a SPEC citar `fetch`, trocar por axios e registrar o desvio. Adicionar `axios` com `--legacy-peer-deps`.

> SPECs 024-026 (app Expo) vivem no repo mobile: `../mobile/specs/` (indice em `../mobile/specs/README.md`). 021-023 (backend) ficam aqui.

## Mobile (sessao 4) — direcao do usuario 2026-09-19
App de MONITORAMENTO/gestao leve, nao operacional. Ordem: 021 -> 022 -> 023 -> 024 -> 025 -> 026 (021-023 backend, 024-026 app; 024 pode comecar apos 021). Todas DRAFT ate `APROVAR SPEC-XXX`.
Decisoes: D-M2..D-M7 APROVADAS (recomendacoes do orquestrador); pendente so D-M8. D-M1 RESOLVIDA (usuario): repo git SEPARADO, pasta irma (`~/Desktop/LeadForge/web` = leadforge atual apos mover; `~/Desktop/LeadForge/mobile` = novo repo Expo); pastas movidas em 2026-09-19 | D-M2 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): destino do codigo nao commitado (reverter Bearer no web, descartar `api/actions`, reescrever OpenAPI) | D-M3 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): Expo managed | D-M4 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): push: polling + Expo Push opcional (gratis) | D-M5 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): retencao: access 15 min, refresh 30 d deslizante, limpeza de dispositivos inativos | D-M6 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): PII no mobile: nenhuma (nomes mascarados, sem telefone/e-mail; corpo de rascunho so sob demanda) | D-M7 APROVADA (usuario, 2026-09-19; recomendacao do orquestrador): quais acoes de gestao permitir (pausar/retomar campanha, kill switch, aprovar/rejeitar, assumir handoff) | D-M8 como o celular alcanca a API (HTTPS publico/tunel/deploy).
