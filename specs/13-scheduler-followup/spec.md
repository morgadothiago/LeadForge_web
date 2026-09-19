# SPEC-013 — Scheduler de follow-up (dias 0,2,5,7,10)
- status: APPROVED (usuario, 2026-09-19; D19 = opcao 1, endpoint /api/cron/tick chamado por cron) | domain: backend | sessao: 2 | ordem: 14 | depende de: SPEC-006, SPEC-010, SPEC-011, SPEC-012
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
