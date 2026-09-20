# SPEC-022 — Mobile: metricas do painel e saude (API read-only)
- status: IMPLEMENTED (backend; validacao em aparelho/dados reais pendente) (aprovada pelo usuario, 2026-09-19) | domain: backend | agente: dev-backend | depende de: SPEC-021 (e leitura de 004, 011, 013, 015, 017, 019) | bloqueia: 025
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

## Implementation Notes
- Arquivos: `src/lib/mobile/{metrics,sanitize}.ts` (servicos read-only sem requireUser), `src/lib/dashboard/metrics.ts` (getMetrics extraido de queries/dashboard.ts, mesmas regras), `src/lib/whatsapp/health-view.ts` (buildInstanceHealthView extraido de queries/whatsapp-health.ts), `SCHEDULER_EXPECTED_INTERVAL_MS` em `scheduler/config.ts`, 8 rotas em `src/app/api/mobile/v1/` (summary, pipeline, campaigns, campaigns/[id], whatsapp/instances, scheduler, agents/queue, lead-search/runs), `src/lib/openapi.ts` (x-status planned removido das 8 rotas; schemas tipados; teste de conformidade AC8 da SPEC-021 continua valendo e ha checagem de "nao planned").
- Testes: `src/lib/mobile/metrics.test.ts` (15). `npm test` 926/926 VERIFIED (apos correcoes de QA); tsc e eslint limpos.
- Criterios: AC1 paridade (summary/pipeline vs queries web) PASS; AC2 varredura instancias PASS; AC3 stale com relogio injetado PASS; AC4 orcamento PASS; AC5 denominador 0 = null PASS; AC6 startOfDaySP PASS; AC7 PASS apos correcao de QA (50 campanhas = 3 queries; instancias = 7 constantes; summary = 3); AC8 no-store e /summary < 5 KB PASS.
- Decisoes: `contacted` = leads distintos com envio outbound no periodo; `responseRate` = {responded, contacted, rate} (responded = desses, com inbound no periodo); `stale` usa intervalo esperado 2 min (docs: cron a cada 1-2 min) => stale se sem rodada ok ha > 4 min ou nenhuma; `lockStuck` = run `running` ha > maxDuration (60 s); `/campaigns?status` default `active`; runs `locked` ignoradas no `lastRun`; numero WhatsApp = `••••` + 4 ultimos digitos; erros sanitizados (URL/token/e-mail/numero removidos, 200 chars). Sem PII de lead em nenhuma rota (nao ha listas de leads; displayName mascarado nao foi necessario). Extracao dos helpers para fora de `queries/` porque testes existentes exigem requireUser em toda funcao async exportada de queries.
- Limitacoes: e-mail sentToday/limite somam todas as contas ativas (sem escopo por usuario); dados reais de WhatsApp/scheduler nao validados (Docker/Evolution); validacao em aparelho pendente.

### Correcoes de QA
- Sanitizacao (`src/lib/mobile/sanitize.ts`): erros de `SearchRun`/`SchedulerRun` NUNCA voltam como texto livre; `errorCategory` mapeia por allowlist (limite de requisicoes, tempo esgotado, nao autorizado pelo provedor, falha de conexao com o provedor, erro interno, fallback `erro`). `pausedReason` e mensagens de alerta de instancia (textos curtos gerados internamente) passam por `redactText` (defesa em profundidade): Authorization/Bearer/Basic inteiro, JWT (`eyJ...`), prefixos de chave (AIza, sk-), qualquer esquema `x://` (postgres, redis, amqp, http), `chave=valor`/`chave: valor`/JSON `"apikey":"..."` (preserva aspas), e-mail, IPs, host:porta, hostnames com TLD interno/publico, caminhos/stack (`/app/src/x.ts:12`), telefones e sequencias de 6+ digitos, tokens longos. Testes adversariais em `metrics.test.ts`. Limite conhecido: hostname de palavra unica sem TLD/porta (ex. `evolution`) so e removido apos ENOTFOUND/ECONN*; nos erros nao ha risco pois viram categoria.
- AC7 (criterio NAO alterado): `/whatsapp/instances` reescrito em lote (`buildInstanceHealthViews`: raw com ROW_NUMBER para 50 envios/5 atualizacoes/10 alertas por instancia + groupBy de sentToday + inbound agrupado; metricas via funcao pura `buildHealthMetrics` compartilhada com `computeHealthMetrics`). `/summary` agora usa 1 SELECT com subselects escalares + 1 findMany de instancias. Contagem REAL medida por teste (spy em `pg.Client.query`, incluindo a query de auth do guard): `/whatsapp/instances` = 7 queries tanto com poucas instancias quanto com 50+ (constante); `/summary` = 3 queries. Ambos <= 8.
- OpenAPI: schemas nested tipados com `additionalProperties:false` e todas as propriedades required (Summary, Metric/Trend, sentToday, attention, Budget, agents, drafts, alerts, lastRun, recentErrors, daily, instancias, campanhas, scheduler, fila, busca). Teste valida as respostas REAIS das 8 rotas contra o schema com ajv 6 (dependencia transitiva do eslint; `npm i -D ajv` deu ERESOLVE, entao NAO foi adicionado ao package.json: risco baixo de sumir se o eslint mudar).
- Escopo por usuario: o WEB e single-tenant. `queries/campaigns.ts` e `dashboard.ts` chamam `requireUser()` apenas como autenticacao e NAO filtram por `userId` (todos os usuarios veem todas as campanhas/metricas). O mobile segue igual: single-tenant, sem escopo por usuario. Nota de risco: se o produto virar multi-tenant, web e mobile (todas as rotas 022) precisam ganhar escopo por `Campaign.userId` (e por conta de e-mail) ao mesmo tempo; nao ha teste de IDOR porque nao ha escopo a violar.

### Decisoes do implementador nao fixadas pela SPEC
- `contacted` = leads distintos com outbound enviado no periodo; `responseRate` = {responded, contacted, rate}, responded = desses, com inbound no periodo.
- `stale`: intervalo esperado 2 min => stale se sem rodada `ok` ha > 4 min (2x) ou nenhuma.
- `lockStuck`: run `running` ha > 60 s (`ROUTE_MAX_DURATION_S`).
- `killSwitch` = true (seguro) quando nao existe `AgentSettings`.
- E-mail `sentToday`/limite: soma das contas ativas (sem escopo por usuario, coerente com single-tenant).
- Fuso: janelas de periodo usam date-fns `startOfDay` (mesmo do painel web, paridade AC1); "hoje" de envios e instancias usa `startOfDaySP` (mesmo criterio do limite diario dos canais).
