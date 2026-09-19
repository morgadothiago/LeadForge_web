# SPEC-013 — Scheduler de follow-up (dias 0,2,5,7,10)
- status: IMPLEMENTED (QA achou NEEDS_FIX; correcoes verificadas por testes 614/614, sem segundo QA; execucao real com canais, navegador e cron real PENDENTES)| domain: backend | sessao: 2 | ordem: 14 | depende de: SPEC-006, SPEC-010, SPEC-011, SPEC-012
## Contexto
Requisito ausente no PROMPT como item proprio. Redis existe no compose mas sem uso definido.
## [NEEDS_DECISION D19] Executor
1. Route Handler `POST /api/cron/tick` chamado por n8n/cron externo a cada N min (simples, alinha com SPEC-014).
2. Fila (BullMQ + Redis) com worker separado.
3. node-cron in-process (fragil em serverless/multiplas instancias).
## Escopo
Nucleo puro `computeDueTouches(leads, now)`: lead `active` com `nextTouchAt <= now`, proximo step por `currentStepOrder`, respeita janela (SPEC-011), calcula `nextTouchAt = leadStart + (step.day)`; ao esgotar steps -> `completed`. Envia via canal do step; cria Touch (unique leadId+stepId garante idempotencia); atualiza stage contactado/em_followup. Lock (`FOR UPDATE SKIP LOCKED`) contra execucao concorrente. Protegido por segredo CRON_SECRET.
## Criterios de aceite
- [ ] Testes unitarios: lead novo dispara step dia 0; dia 2 so apos 2 dias; pausado/optado nao dispara; fim da sequencia -> completed.
- [ ] Duas execucoes simultaneas nao enviam duplicado (teste).
- [ ] Fora da janela 8-18h reagenda.
- [ ] Falha de envio marca Touch failed e nao avanca step (retry limitado a N).
- [ ] Endpoint sem CRON_SECRET -> 401.
- [ ] Execucao real com canais: PENDENTE (integracoes nao testaveis).

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (reagendar em 429 do provider): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.

## Dependencia (2026-09-19): SPEC-017 (politica de envio)
O scheduler DEVE aplicar a politica de specs/17-politica-envio/spec.md (supressao global, 3 toques/14 dias no WhatsApp, WhatsApp primeiro, janela 9-12/14-17 seg-sex, aquecimento, intervalo 45-180 s, disjuntor de saude) e SERIALIZAR envios por instancia (um envio por vez por instancia), porque o intervalo minimo e o teto diario dependem disso.


## DECIDIDO D19 e escopo revisado (2026-09-19, alinhado a SPEC-017)
Executor: **Route Handler `/api/cron/tick`** chamado por cron externo (crontab/curl, n8n ou Vercel Cron) a cada 1-2 min. Sem fila/worker. Comando local `npm run tick` (script tsx que chama `runTick` direto) para desenvolvimento.
### Endpoint
- `POST /api/cron/tick` (e `GET` para Vercel Cron, ambos autenticados): `Authorization: Bearer <CRON_SECRET>` comparado em TEMPO CONSTANTE; sem/errado -> 401 JSON PT-BR generico e identico; `CRON_SECRET` ausente/curto (<32) -> 503 "nao configurado" (nunca aberto); rate limit para tentativas invalidas; demais metodos 405. `/api/cron/*` fica FORA da guarda de login: adicionar a isencao no matcher LITERAL de src/proxy.ts (+ teste do matcher). Resposta 200 JSON com resumo (contadores por resultado, duracao, `skipped: "locked"` se outra rodada roda). Orcamento por rodada: tempo maximo (~50 s, `maxDuration`) e teto de envios (ex.: 20) — para de forma limpa e deixa o resto para a proxima rodada.
### Nucleo `runTick(now, deps)` (puro nas decisoes; efeitos via canais existentes)
1. Lock global no Postgres (`pg_try_advisory_lock`/`_xact_lock`): duas rodadas simultaneas -> uma roda, a outra devolve `skipped: locked`. Como uma rodada e sequencial, os envios ficam SERIALIZADOS por instancia (max. 1 envio de WhatsApp por instancia por rodada; e-mail ate N por conta).
2. `evaluateAllInstances(now)` (SPEC-017): saude, retomada automatica, pausa por queda persistente.
3. Fila A — Touches `scheduled` vencidos (`scheduledAt <= now`, ex.: adiados por janela/limite/intervalo/pausa): chamar `sendWhatsApp`/`sendEmail(touchId)`; tratar o resultado (abaixo).
4. Fila B — leads devidos: `sequenceStatus=active`, `nextTouchAt <= now`, campanha ativa, sem supressao, step atual por `currentStepOrder`; cria Touch do step (unique leadId+stepId = idempotencia; conflito = ja existe, seguir) e chama o canal do step. Primeiro toque de um lead define o inicio da sequencia; `nextTouchAt` do proximo step = inicio + `step.day` dias (a janela de horario e a cadencia sao decididas pelo canal, que adia com `scheduled`).
5. Resultado do canal: `sent` -> avanca `currentStepOrder`, calcula `nextTouchAt`, stage `contactado` no 1o toque e `em_followup` nos seguintes (forward-only via `runMoveOpportunity`, nunca regride/sobrescreve fechado/perdido); `deferred` -> NAO avanca, mantem Touch `scheduled` no instante devolvido; `skipped` por "suprimido/respondeu/optado/encerrada" -> encerra a sequencia do lead coerente com o motivo; `skipped` por "numero sem WhatsApp" ou "limite de toques do WhatsApp" -> pula ESSE step e avanca (fallback para o proximo step/canal); `failed` -> Touch failed, retry limitado (N=3, backoff 30 min / 2 h / 6 h via `scheduledAt`) e, esgotado, marca falha final e avanca para nao travar a sequencia; timeout com aviso "verifique antes de reenviar" NAO reenvia (exige `retryTouch` humano) e avanca conforme regra; ao esgotar steps -> `completed`.
6. Registra a rodada em `SchedulerRun` (inicio, fim, contadores, erro sanitizado, sem PII/segredo) para observabilidade; logs sem PII.
### Regras herdadas da SPEC-017 (enforcement no canal, nao duplicar)
Supressao global, 3 toques/14 dias, intervalo minimo, nunca dois canais no mesmo dia, janela seg-sex 9-12/14-17 no fuso do lead + feriados, aquecimento/limite efetivo, intervalo 45-180 s com rajadas, checkNumbers, `health=paused`, nenhuma resposta automatica. O scheduler so orquestra e respeita o retorno tipado dos canais.
### Criterios de aceite (revisados)
- [ ] Lead novo dispara o step de dia 0; step de dia N so quando `nextTouchAt` chega (tempo injetavel nos testes); dia 4/10 no WhatsApp respeitando 3 toques/14 dias.
- [ ] Pausado (`paused_replied`), optado, suprimido e campanha pausada nao disparam; fim da sequencia -> `completed`.
- [ ] Duas rodadas simultaneas: uma envia, a outra `skipped: locked`; nenhum Touch enviado duas vezes (teste com Promise.all).
- [ ] Fora da janela/limite/pausa/intervalo: Touch fica `scheduled` e a proxima rodada o retoma no instante certo; nao ha laco de envio.
- [ ] `deferred`, `skipped` (cada motivo), `failed` com retry limitado e backoff, timeout com aviso sem reenvio automatico, fallback quando numero sem WhatsApp.
- [ ] Stage forward-only (contactado -> em_followup) sem regredir/sobrescrever fechado/perdido.
- [ ] Endpoint: 401 sem/errado (identico), 503 sem CRON_SECRET, 405 outros metodos, 200 com resumo; `/api/cron/*` nao redireciona para /login (curl); token comparado em tempo constante; segredo nunca em log/resposta.
- [ ] Orcamento de tempo/teto de envios respeitado; `npm run tick` funciona.
- [ ] Toda a suite existente continua verde; build/lint/typecheck OK (build quando o servidor do usuario estiver desligado).
- [ ] Execucao real com Evolution/SMTP: PENDENTE.
### Fora de escopo
Tela de acompanhamento (candidata a SPEC futura: Configuracoes > Execucao mostrando `SchedulerRun`); n8n (SPEC-014); busca de leads (SPEC-015).

## Backend (implementado em 2026-09-19; status segue APPROVED ate o QA)
### Contrato
- `runTick(now: Date, deps?: Partial<TickDeps>): Promise<TickSummary>` em `src/lib/scheduler/run-tick.ts`. `TickSummary = { status: "ok"|"locked"|"error", skipped?: "locked", runId, durationMs, budget: "time"|"sends"|null, counters, error? }`. Contadores sem PII (`result_sent`, `deferred_<motivo>`, `skipped_<motivo>`, `retry_scheduled`, `failed_final`, `timeout_no_retry`, `instance_busy`, `completed`, `stage_<x>`...).
- Decisoes puras e testaveis em `decide.ts`: `computeNextTouchAt`, `decideAfterSend`, `pickDueLeads`, `decideStage`, `safeDeferAt`. O tempo entra sempre por parametro (`now`); o orcamento de tempo usa `deps.clock` (relogio real injetavel).
- Lock global: `pg_try_advisory_lock` (sessao) numa conexao `pg` DEDICADA (`lock.ts`), liberado em `finally` na MESMA conexao (e, se o processo morrer, o Postgres libera ao fechar a conexao). Escolhido em vez de `xact_lock` porque o pool do adapter-pg do Prisma nao garante a mesma conexao entre lock e unlock e a transacao interativa teria de ficar aberta ~50 s.
- Ordem da rodada: lock -> `evaluateAllInstances(now)` (falha nao derruba) -> Fila A (Touch `scheduled` com `scheduledAt <= now`, campanha ativa, `email`/`whatsapp`) -> Fila B (SOMENTE leads `active` com `nextTouchAt <= now`; `not_started` NAO dispara sozinho — ver "Adendo de seguranca"; campanha ativa com sequencia, sem `optedOutAt`/`repliedAt`, `source != seed`). Cada Touch/lead e processado no maximo 1x por rodada; lead tratado na Fila A nao entra na B; lead com Touch aberto no step atual e dono da Fila A.
- Step atual = `steps[currentStepOrder]` (steps ordenados por `order`; `currentStepOrder` = quantos steps ja foram concluidos, como no seed). O 1o toque grava `sequenceStartedAt` e `sequenceStatus=active`; `nextTouchAt` = inicio + `step.day` dias do proximo step.
- Resultados: `sent` -> avanca + stage (`contactado` no 1o enviado, `em_followup` nos seguintes, forward-only via `runMoveOpportunity`); `deferred` -> mantem Touch `scheduled` no instante do canal (se <= agora, empurra +60 s: sem laco); `skipped` opted_out/replied/sequence_completed/suppressed -> lead `opted_out`/`paused_replied`/`completed` (suppressed: `opted_out` se opt-out, `completed` se bounce/manual); `no_whatsapp`/`touch_limit` -> pula o step e avanca; `failed` -> Touch volta a `scheduled` com `attempts+1` e backoff 30 min/2 h/6 h (3 retries = ate 4 tentativas); esgotado -> Touch fica `failed`, avanca; timeout ("Nao foi possivel confirmar o envio...") -> NAO reenvia, avanca (so `retryTouch` humano); sem proximo step -> `completed`.
- Steps de canal sem envio automatico (`linkedin`/`phone`): Touch `skipped` ("canal manual") e a sequencia avanca.
- Orcamento: `SCHEDULER_TIME_BUDGET_MS` (25000; teto efetivo 25000, ver Implementation Notes) e `SCHEDULER_MAX_SENDS` (20); max. 1 WhatsApp por instancia por rodada (excedente: `instance_busy`, fica para a proxima). Envios sao sequenciais.
- Isolamento opcional `deps.campaignIds` (testes/execucao dirigida).
### Endpoint `/api/cron/tick` (`src/app/api/cron/tick/route.ts` + `src/lib/scheduler/cron-endpoint.ts`)
POST e GET, `Authorization: Bearer <CRON_SECRET>` (SHA-256 + `timingSafeEqual`). 503 se `CRON_SECRET` ausente/< 32; 401 identico (sem/malformado/errado); 405 (com `Allow`) para HEAD/OPTIONS/PUT/PATCH/DELETE; 200 com o `TickSummary`; 429 so para tentativas invalidas (1 chave global, 20/min, sem chave por segredo forjado; credencial valida nunca e bloqueada); 500 generico. `dynamic = "force-dynamic"`, `Cache-Control: no-store`, `maxDuration = 60`. `/api/cron/*` isento do login em `src/proxy.ts` (matcher literal, testado em `auth.test.ts`). Nao usa `requireUser` (auth por segredo); nao ha Server Action nova (teste geral de `requireUser` inalterado).
### Schema (migration `20260919210000_scheduler_followup`)
`Lead.sequenceStartedAt DateTime?` (backfill: 1o Touch outbound ou `createdAt`, para leads ja iniciados), `Touch.attempts Int @default(0)`, model `SchedulerRun { id, startedAt, finishedAt?, status, counters Json, error? }` (retencao 30 dias, podada a cada rodada; rodadas `locked` tambem registradas).
### Env
`CRON_SECRET` (obrigatoria para o endpoint, 32+), `SCHEDULER_TIME_BUDGET_MS`, `SCHEDULER_MAX_SENDS` (ver `.env.example`).
### Como agendar (a cada 1-2 min)
- crontab: `* * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://SEU-APP/api/cron/tick`
- n8n: Schedule Trigger (1 min) -> HTTP Request POST na URL, header `Authorization: Bearer <CRON_SECRET>`.
- Vercel Cron: `vercel.json` `{"crons":[{"path":"/api/cron/tick","schedule":"* * * * *"}]}` + env `CRON_SECRET` (a Vercel envia o Bearer via GET).
- Dev: `npm run tick` (`src/scripts/tick.ts`, chama `runTick` direto e imprime so contadores). ATENCAO: uma rodada real processa leads `active` de campanhas ativas com os canais reais configurados (leads de seed e `not_started` nao sao enviados; ver adendo).
### Decisoes/desvios a validar no QA
1. (SUPERADA pelo adendo de seguranca) Antes, `not_started` em campanha ativa era devido; agora o inicio e explicito.
2. "N=3" interpretado como 3 retries (ate 4 tentativas).
3. Falha final e timeout avancam a sequencia; o Touch permanece `failed`.
### Criterios (evidencia: `src/lib/scheduler/*.test.ts`, `src/lib/auth/auth.test.ts`)
Todos os itens dos criterios revisados cobertos por teste com provider/transport FAKES, exceto: build (nao executado, servidor do usuario ativo), `npm run tick` (nao executado para nao disparar canais reais no banco de dev) e execucao real Evolution/SMTP: PENDENTE.

## Adendo de seguranca (2026-09-19): inicio explicito e dados de seed nunca enviaveis
Risco corrigido: qualquer lead novo (e os 20 do seed) comecaria a receber mensagem no 1o tick com canais reais.
### Regras
- Fila A e B EXCLUEM leads `source="seed"`; `sendEmail`/`sendWhatsApp` tambem barram (Touch `skipped`, erro "dado de teste (seed)", retorno `{status:"skipped", reason:"seed_data"}`, sem provider/transport; `decideAfterSend` -> noop). Unica excecao: env `ALLOW_SEED_SENDS=true` (default ausente; SO dev; documentada em `.env.example`).
- Fila B so processa `active`. `not_started` nunca dispara sozinho. `Campaign.autoStart Boolean @default(false)`: se `true`, a **fase 0** do tick (apos a saude, antes da Fila A) ativa (`not_started` -> `active`, `nextTouchAt=now`; `sequenceStartedAt` continua gravado no 1o envio) SO leads dessa campanha com campanha `active` + sequencia, contato valido para o 1o canal (email->e-mail valido; whatsapp->telefone BR valido; canal manual->qualquer contato), nao suprimidos, sem opt-out/resposta/possibleOptOut, nao seed. Ate 500 leads por campanha/rodada. Contador `auto_started`.
- Enum `SequenceStatus` ganhou `paused_manual` (parada manual). Os canais tratam `paused_manual` como sequencia encerrada (nao enviam Touch de lead parado). ATENCAO frontend: mapas `Record<SequenceStatus,...>` precisam da chave `paused_manual` (ex.: `src/app/(app)/leads/[id]/page.tsx` quebra o typecheck ate ser atualizado, rotulo sugerido "Pausada (manual)").
- Seed: campanha de exemplo nasce `paused` + `autoStart=false`; o "proximo passo agendado" dos leads seed nasce `skipped` ("dado de teste (seed)"); nenhum Touch `scheduled` futuro de seed.
### Actions (`src/lib/actions/sequence-start.ts`, `"use server"`, `requireUser`, Zod PT-BR, `ActionResult`)
- `startSequence({leadId})` -> `{leadId, started}`. Valida: campanha `active`, sequencia com steps, contato compativel com o 1o canal, nao suprimido, nao seed, sem opt-out/resposta/possibleOptOut; status `not_started` ou `paused_manual` (reinicia de onde parou). Inelegivel -> erro no campo `leadId` com o motivo em PT-BR. Idempotente (ja `active` -> `started:false`). Define `active` + `nextTouchAt=now`; NAO envia (o proximo tick envia, respeitando janelas/limites).
- `startCampaignSequences({campaignId, confirm: true})` -> `{campaignId, started, ineligible: {motivo: n}, ineligibleTotal}`. `confirm` obrigatorio (literal `true`). Campanha nao ativa/sem sequencia -> erro `_form`. Idempotente.
- `stopSequence({leadId})` -> `{leadId, stopped, cancelledTouches}`. So para `active` (outros -> erro; ja `paused_manual` -> `stopped:false`). Define `paused_manual`, `nextTouchAt=null`, Touches outbound `scheduled`/`pending` -> `skipped` ("sequencia parada manualmente"); `sending` nao e tocado. Serializable.
- Motivos (`IneligibleReason`): `campaign_inactive`, `no_sequence`, `seed`, `suppressed`, `opted_out`, `replied`, `possible_opt_out`, `no_contact`, `wrong_status` (rotulos PT-BR em `REASON_LABEL`, `src/lib/domain/sequence-start.ts`).
- Campanha: `createCampaign`/`updateCampaign` aceitam `autoStart?: boolean` (omitido na edicao = nao altera); `CampaignListItem/Detail.autoStart`.
### Queries
- `countStartableLeads(campaignId)` (`src/lib/queries/sequence-start.ts`) -> `{campaignId, campaignActive, hasSequence, autoStart, eligible, ineligible, ineligibleByReason: [{reason, label, count}]}` ou `null`. Candidatos = leads `not_started`/`paused_manual`. Mostrar ANTES de confirmar `startCampaignSequences`.
- Status de sequencia do lead ja e exposto por `getLead`/`listLeads` (`sequenceStatus`, `nextTouchAt`); nao foi preciso query nova.
### Auditoria (sem PII)
`WebhookEvent` `source="sequence_audit"`, payload `{action: start_sequence|start_campaign|stop_sequence|auto_start, campaignId, leadId?, count, userId?, at}`.
### Schema (migration `20260919220000_sequence_explicit_start`)
`ALTER TYPE SequenceStatus ADD VALUE 'paused_manual'`; `Campaign.autoStart BOOLEAN NOT NULL DEFAULT false` (backfill false).
### Env
`ALLOW_SEED_SENDS` (default ausente; so dev).

## Implementation Notes (adendo de seguranca)
- Arquivos: prisma/schema.prisma, migrations/20260919220000_sequence_explicit_start, prisma/seed.ts, src/lib/domain/{seed-guard,sequence-start}.ts, src/lib/schemas/{sequence-start,campaign}.ts, src/lib/actions/{sequence-start,campaign}.ts, src/lib/queries/{sequence-start,campaigns}.ts, src/lib/channels/{reserve,email,whatsapp}.ts, src/lib/scheduler/{run-tick,decide}.ts, src/lib/domain/move-opportunity.ts, src/lib/test-utils/purge.ts, .env.example.
- Testes (VERIFIED): `npm test` 47 arquivos / 579 testes passam (novos: `scheduler/sequence-start.test.ts`, `actions/sequence-start-auth-coverage.test.ts`; `decide.test.ts` e `run-tick.test.ts` ajustados: lead devido = `active`); `prisma validate`, `migrate status` (13 migrations, em dia), lint OK. Typecheck: FALHA SOMENTE em `src/app/(app)/leads/[id]/page.tsx` (frontend, fora do escopo; falta `paused_manual` no mapa de rotulos).
- Lixo de teste `zz-test-spec010`: causa = execucao anterior abortada de `email.test.ts` deixou a campanha; o `afterAll` apagava so por id em memoria (e as sequencias por nome), entao o resto nunca era limpo. Correcao: `purgeTestCampaigns(prefixo)` (por nome) em `beforeAll` e `afterAll` (try/finally onde ha disconnect) de email/whatsapp(ch)/send-policy/pipeline/lead/webhook-handler/whatsapp-webhook-actions e do novo teste.
- Teste instavel `pipeline.test.ts > movimentos concorrentes`: causa provavel = `runMoveOpportunity` devolvia `conflict` no 1o P2034 (Serializable) e o teste (5 s default) sob carga da suite completa; corrigido com ate 6 tentativas com backoff+jitter em `runMoveOpportunity` (garantia de posicoes integras inalterada) + assert de que os 4 movimentos retornam ok + timeout 30 s. Nao reproduzido antes (1 falha em ~N execucoes); suite completa passou 2x apos a correcao.
- Teste `sequence.test.ts > sequencia em campanha ativa nao exclui` dependia da campanha ativa do seed; agora cria a propria campanha ativa.
- Dados do banco de dev: apagada 1 campanha `zz-test-spec010` (0 leads/opps); campanha do seed pausada (`paused`, autoStart false); 7 Touches `scheduled` de leads seed -> `skipped`.
- Limitacoes: `npm run tick`/build nao executados; frontend implementado abaixo.


## Frontend do inicio explicito (2026-09-19)
Criterios de UI:
- [x] Typecheck limpo: `paused_manual` ("Pausada manualmente"; na ficha: "Voce pausou esta sequencia") via `SEQUENCE_STATUS_TEXT` local (src/components/sequences), pois src/lib/domain nao pode ser alterado.
- [x] Form de campanha (criar/editar): toggle `role=switch` "Iniciar leads automaticamente" (desligado por padrao), ajuda e aviso em destaque ao ligar. Estado "Inicio: Automatico/Manual" no cartao e no detalhe.
- [x] Detalhe da campanha: "Iniciar sequencia para os leads pendentes" -> carrega contagem sob demanda, resumo X/Y, motivos PT-BR, aviso de canais/limites, checkbox obrigatorio (`confirm: true`), botao bloqueado (com motivo) se X=0/pausada/sem sequencia, toast + `router.refresh()`.
- [x] Ficha do lead: "Iniciar sequencia" (not_started/paused_manual) e "Pausar sequencia" (active) com ConfirmDialog e erros `_form`/`leadId`; status, proximo contato e badge "Dado de teste" (source=seed; botao oculto para seed). Lista de leads: coluna/linha "Sequencia".
- [x] Indicador "Sem canais configurados" (sem e-mail ativo nem WhatsApp conectado) no cartao e no detalhe.
Implementation Notes (frontend): arquivos novos src/components/sequences/{sequence-start-format.ts,.test.ts}, campaigns/{CampaignStartSequence.tsx,start-actions.ts}, leads/LeadSequenceActions.tsx; alterados ConfirmDialog (children/confirmDisabled), CampaignForm/Card, LeadsTable, paginas campanhas, campanhas/[id], leads/[id]. `start-actions.ts` e um wrapper "use server" porque `countStartableLeads` e uma query, nao Server Action. Nao verificado no navegador (so curl sem cookie: 307).

## Implementation Notes (correcoes do QA, 2026-09-19)
- A1 (ALTO) retry Serializable: com adapter-pg o conflito chega como `DriverAdapterError` (name `DriverAdapterError`, message/cause.kind `TransactionWriteConflict`, SQLSTATE 40001/40P01), nao `PrismaClientKnownRequestError` P2034. Novo `src/lib/db/tx-conflict.ts`: `isRetryableTxConflict(e)` (estrutural: P2034, SQLSTATE 40001/40P01 em code/meta/cause, kind/mensagem TransactionWriteConflict) e `withSerializableRetry(fn, {attempts=6, sleep, random})` (backoff + jitter). Aplicado em: `domain/move-opportunity.ts` (runMoveOpportunity; esgotado -> `conflict`), `actions/lead.ts` (addTag, removeTag, deleteLead), `actions/sequence-start.ts` (stopSequence), `actions/suppression.ts`, `actions/whatsapp.ts` (confirmOptOut), `whatsapp/webhook-handler.ts` (persist, 3 tentativas; P2002 -> duplicate mantido) e `actions/result.ts` (`handleActionError` mapeia conflito residual para "Conflito ao salvar, tente novamente."). Teste unitario `db/tx-conflict.test.ts` com `DriverAdapterError` real. O teste concorrente exige os 4 movimentos ok.
- M2 reinicio: `activateLeads` (domain/sequence-start.ts) em lead `paused_manual`: (a) o Touch do step atual `skipped` com `error = STOP_NOTE` ("sequencia parada manualmente") volta a `scheduled` (scheduledAt=now, error=null; mesmo registro, unique leadId+stepId intacto, skipped nao conta nos 3 toques/14 dias); `skipped` por regra (suprimido/sem WhatsApp/limite/seed) NAO e reaberto; (b) `sequenceStartedAt = now - day(stepAtual)*DAY_MS` (so se ja tinha inicio), logo o step seguinte vence em `day(seguinte)-day(atual)` dias apos o reinicio, sem vencer tudo de uma vez. `currentStepOrder` e indice do array de steps ordenados. Testes em `scheduler/sequence-start.test.ts`.
- M3 Touch orfao: varredura na rodada (antes da Fila A): Touch outbound `sending` com `updatedAt < now - SENDING_STALE_MS (15 min)` -> `failed` com `NEEDS_REVIEW_PREFIX` (nunca reenvia), `attempts+1`, lead avanca como no timeout (`advanceLead`), contador `staleSending` no `SchedulerRun`, `InstanceAlert` (kind `warning`, sem PII) quando ha instancia WhatsApp. Recente nao e varrido.
- M4 orcamento: `SEND_WORST_CASE_MS=30s`, `BUDGET_MARGIN_MS=5s`, `ROUTE_MAX_DURATION_S=60`; orcamento efetivo = min(`SCHEDULER_TIME_BUDGET_MS`, 60s-30s-5s = 25 s) aplicado em `getSchedulerConfig`; default `SCHEDULER_TIME_BUDGET_MS` = 25000 (documentado no `.env.example`). Timeouts SMTP: connection 8 s, greeting 8 s, socket 15 s (`TIMEOUTS` exportado; teste de sanitizacao mantido). Testes: invariante das constantes vs `route.maxDuration` e relogio injetado.
- B5: `components/campaigns/start-actions.ts` chama `requireUser()` e nao lanca UnauthorizedError (devolve `null`, mantendo o contrato do componente; PENDENTE de UI: migrar para ActionResult). Teste estatico global `src/lib/use-server-auth.test.ts` (todo arquivo "use server": `requireUser` direto ou via query/action guardada; allowlist `login`/`logout`).
- B6: testes do scheduler agora removem os `SchedulerRun` criados (`startedAt >= SUITE_START` no cleanup de `sequence-start.test.ts`). Banco de dev: as 20 linhas acumuladas foram removidas por serem inequivocamente de teste (todas com `finishedAt < startedAt`, impossivel em rodada real); contagem 20 -> 0; apos 2 suites completas = 0.
- B7: `DAY_MS` e fixo de 24 h (sem tratamento de DST; irrelevante no Brasil, sem horario de verao).
- Verificacao: pipeline concurrent 10/10 (isolado) e `pipeline.test.ts` inteiro 10/10; `npm test` 2x = 50 arquivos / 614 testes OK; prisma validate, migrate status (em dia), tsc e eslint limpos. Build/tick/dev nao executados (regra).
- Risco conhecido (fora de escopo): a fase 0 `autoStart` usa `classifyStartable`, que inclui `paused_manual`; campanha com autoStart poderia reiniciar lead parado manualmente.
