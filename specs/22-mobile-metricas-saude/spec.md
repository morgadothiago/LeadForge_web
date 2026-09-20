# SPEC-022 — Mobile: metricas do painel e saude (API read-only)
- status: DRAFT | domain: backend | agente: dev-backend | depende de: SPEC-021 (e leitura de 004, 011, 013, 015, 017, 019) | bloqueia: 025
## Objetivo
Endpoints GET agregados (calculo no servidor, payload pequeno) que respondem "como esta indo": funil, atividade, saude dos canais/scheduler/agentes/busca. Reaproveitar `src/lib/queries/*` (dashboard.ts, pipeline.ts, campaigns.ts, whatsapp-health.ts, agent.ts, lead-search.ts) extraindo a logica pura para funcoes sem `requireUser`/cookie, chamadas pelo guard mobile. NAO duplicar regras (limite efetivo, saude, orcamento).
## Endpoints e dados
- `GET /summary?period=7d|30d`: leads novos, contatados, respondidos, opt-out (Suppression por periodo), taxa de resposta (respostas/contatados, com denominador explicito), reunioes; tendencia vs periodo anterior (reusar `Metric/Trend`); mensagens enviadas hoje vs limite (soma `sentToday`/`effectiveLimitToday` das instancias + e-mail); falhas de envio (Touch com status de falha, 24h); "cards de atencao" (contagem de alertas nao lidos, handoffs, rascunhos).
- `GET /pipeline`: contagem e valor por `Stage` (funil), sem lista de leads.
- `GET /campaigns?status=`: campanhas em andamento (`CampaignStatus`), por campanha: enviados, respostas, taxa, leads ativos, proximo envio; paginado. `GET /campaigns/{id}`: mesmos numeros + serie diaria 7d.
- `GET /whatsapp/instances`: por instancia apenas `id`, apelido/`instanceName`, numero MASCARADO (ultimos 2-4 digitos), status (`WaStatus`), `health`, `pausedUntil/pausedReason`, `warmupDay`, `sentToday/effectiveLimitToday`, `warnings`, alertas recentes (`InstanceAlert` kind/message/createdAt/readAt) incl. possivel banimento e possivel opt-out. Sem `apiKey`/`webhookToken`.
- `GET /scheduler`: ultima `SchedulerRun` (startedAt, finishedAt, status, contadores, erro sanitizado), `stale` = sem rodada bem-sucedida ha > 2x intervalo (config em `scheduler/config.ts`), lock ativo ha tempo anormal, ultimos N runs com erro.
- `GET /agents/queue`: rascunhos pendentes (contagem + mais antigo), handoffs "Precisa de voce" (contagem), gasto do mes vs teto (`AgentSettings.monthlyBudgetCents`, `budgetState`, %), `killSwitch`, por agente: ativo, gasto/teto.
- `GET /lead-search/runs`: ultimos `SearchRun` (source, status, found/created/duplicate/suppressed/invalid, erro sanitizado); ja sem PII.
- Metricas de listas: `displayName` mascarado conforme SPEC-021; sem telefone/e-mail.
## Criterios de aceite
1. Cada endpoint retorna os mesmos numeros que a tela web equivalente para o mesmo seed (teste comparando com as queries existentes).
2. `/whatsapp/instances` nunca contem numero completo, apiKey, webhookToken (teste de varredura).
3. `stale=true` quando ultima rodada OK e mais antiga que o limiar; `false` caso contrario (relogio injetado).
4. Orcamento: 79%=ok, 80%=alert, 100%=exhausted, sem teto=no_budget (reusa `budgetState`).
5. Taxa de resposta com denominador 0 = `null` (nao NaN/0).
6. Fuso: "hoje" via `startOfDaySP`, igual ao web.
7. Desempenho: cada endpoint <= 8 queries e usa agregacao (`groupBy/count`), sem N+1; teste que conta queries no caso de 50 campanhas.
8. Payload de `/summary` < 5 KB; todos GET com `no-store`.
## Testes obrigatorios
Vitest com seed: paridade com web, mascaramento, stale, orcamento, denominador zero, contagem de queries, paginacao.
## Seguranca / LGPD
Somente agregados; sem PII; erro de SchedulerRun/SearchRun sanitizado (sem URL com chave/token).
## Fora do escopo
Qualquer escrita; listas de leads; detalhes de conversa.
## Limitacoes de validacao
Dados reais de WhatsApp/scheduler dependem de Docker/Evolution (pendente); validar com seed e fixtures.
