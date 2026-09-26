# SPEC-028 — Reunioes agendadas: backend (Meeting, lembretes, resumo de notificacoes)
- status: IMPLEMENTED (2026-09-21; backend; push real e migrate no banco de dev PENDENTES do usuario; aprovada em 2026-09-21, D-R1..D-R16) | domain: backend | agente: dev-backend | sessao: 5 | depende de: SPEC-001, 007, 012, 013, 019, 023
- Par frontend: SPEC-029 (`specs/29-calendario-notificacoes-frontend/spec.md`), depende desta. Diretorio mantido como `28-calendario-reunioes-notificacoes` (numeracao imutavel); escopo = SOMENTE backend.
- Numeracao: 24-26 sao do repo mobile; 027 ocupada.

## Objetivo
Persistir e operar reunioes com data/hora (America/Sao_Paulo), emitir lembretes (alertas) reaproveitando o pipeline `MobileAlert`/`sweepThrottled` e expor ao web autenticado por sessao o resumo e as acoes de leitura das notificacoes. Nenhuma UI aqui.

## Contexto (lido do codigo)
- `model Meeting` existe (`prisma/schema.prisma`): opportunityId (obrigatorio), leadId, `scheduledAt`, `duration` (min, default 30), `calendarEventId?`, `status String @default("scheduled")`, `createdAt`. Sem campaignId, timezone, link, source, notes, updatedAt.
- Ninguem cria Meeting hoje (`meeting.create` = 0 no src). So lida na metrica `meetings` (`src/lib/dashboard/metrics.ts`, `meeting.count` por `createdAt`) e mocks. Stage `reuniao_agendada` existe (`src/lib/domain/move-opportunity.ts`); mover nao cria Meeting.
- Alertas (SPEC-023): `MobileAlert` (dedupeKey unico, sem PII, `readAt`/`resolvedAt`), `raiseAlert(Candidate)` idempotente (P2002), `sweepThrottled(now)` chamado em `run-tick.ts:104` (cron `/api/cron/tick`, 1-2 min, `SCHEDULER_EXPECTED_INTERVAL_MS`=2 min), `sendPushForAlert` em `expo-push.ts`, `pushPrefs` por kind, `MAX_PUSHES_PER_SWEEP`, `PUSH_WAIT_CAP_MS`. Alerta `handoff` em `src/lib/mobile/alerts.ts` (link https so na API autenticada, nunca no push). Endpoints mobile `alerts`, `[id]`, `read-all`, `unread-count` (Bearer mobile; NAO reusar no web).
- Webhooks/chave de API: SPEC-018 (`api/integrations/leads`). E-mail/WhatsApp sao canais de prospeccao, nao de lembrete interno (D-R6).

## Decisoes (todas APPROVED pelo usuario em 2026-09-21, conforme recomendacao)
- D-R1 APPROVED: separar em SPEC-028 (backend) + SPEC-029 (frontend, inclui sino/Sheet/sidebar/`/notificacoes`).
- D-R2 APPROVED: notificacoes web leem o mesmo `MobileAlert` (sem tabela `Notification`).
- D-R3 APPROVED: `opportunityId` obrigatorio (reuniao sempre ligada a oportunidade/campanha).
- D-R4 APPROVED: agente/Closer NAO sugere reuniao na v1; so manual + webhook (`source=agent` existe no enum mas nao e usado).
- D-R5 APPROVED: fuso fixo America/Sao_Paulo por padrao; semana inicia na segunda (UI, SPEC-029).
- D-R6 APPROVED: lembretes so ao usuario (web+mobile); nunca ao lead por WhatsApp/e-mail.
- D-R7 APPROVED: Google Calendar/ICS fora da v1.
- D-R8 APPROVED: conflito de horario = apenas aviso, nunca bloqueio.
- D-R9 APPROVED: metrica `meetings` mantem semantica por `createdAt` e exclui `cancelled`.
- D-R10 APPROVED: (SPEC-029) shadcn Calendar + grade custom.
- D-R11 APPROVED: offsets padrao 24h/1h/15min, configuraveis (`MeetingSettings` singleton).
- D-R12 APPROVED: novo kind de push ligado por padrao.
- D-R13..D-R16 APPROVED: pertencem a SPEC-029 (bolinha simples; itens Calendario/Leads/Aprovacoes/Configuracoes/Notificacoes; polling 30 s sem SSE; visitar area NAO marca lida). O backend so fornece o resumo por area e as acoes de marcar lida.

## Escopo
1. Migracao aditiva de `Meeting` (sem dropar dados): `startsAt` (migrar `scheduledAt`), `endsAt` (= startsAt + duration; `duration` derivado/mantido, remocao so em fase 2), `timezone String @default("America/Sao_Paulo")` (IANA validado), `status` enum `MeetingStatus { scheduled done cancelled no_show }` (valores string existentes migrados; desconhecido -> scheduled), `link String?` (https), `source` enum `MeetingSource { manual agent webhook }`, `notes String?` (max 2000), `campaignId` (derivado da Opportunity, indexado), `createdById?`, `updatedAt`, `cancelledAt?`, indices `[startsAt]`, `[status,startsAt]`. `calendarEventId` mantido sem uso. `externalId String?` com unique parcial (webhook).
2. Dominio `src/lib/domain/meeting.ts`: criar/editar/cancelar/realizada/no-show; `endsAt > startsAt`, duracao 5..480 min, data futura na criacao, `link` so `https://`; sobreposicao so AVISO (retorno `conflicts`). Ao criar (scheduled): se Opportunity nao esta em `reuniao_agendada`, mover via `moveOpportunity` (StageHistory). Cancelar NAO desfaz o stage (retorna aviso para a UI).
3. Server Actions `src/lib/actions/meeting.ts` (`ActionResult` + `requireUser`, zod em `src/lib/schemas/meeting.ts`, `clientRequestId` anti duplo clique) e queries `src/lib/queries/meetings.ts` (intervalo `from/to` obrigatorio, teto 62 dias, ordenado por startsAt, sem N+1; busca de leads para o dialog).
4. Webhook `POST /api/integrations/meetings` com chave de API (SPEC-018): zod `{leadId|phone, startsAt ISO com offset, durationMin?, link?, externalId?}`, idempotente por `externalId`, 401 sem chave, 429 + Retry-After conforme regras transversais, sem ecoar corpo/segredo em erro.
5. Lembretes via `MobileAlert` kind `meeting_reminder` emitidos em `sweepThrottled` (`collect`). `MeetingSettings` singleton: offsets validos {1440,120,60,30,15,5}, ligar/desligar, actions para ler/salvar. dedupeKey `meeting_reminder:{meetingId}:{startsAtMs}:{offsetMin}`; reagendar gera novos, cancelar/editar/passada resolve pendentes (`resolvedAt`). Janela: `now >= startsAt - offset` e `now < startsAt`; emitir apenas o menor offset ainda valido (nunca lembrete vencido). Baseline: reuniao ja dentro da janela ao ligar nasce lida (sem push retroativo). `MAX_PUSHES_PER_SWEEP` e `PUSH_WAIT_CAP_MS` preservados.
6. Texto FIXO sem PII: "Reuniao em 1 hora" / "Voce tem uma reuniao agendada. Abra o app para ver os detalhes." (relativo "em 15 min" permitido). Nunca nome, telefone, e-mail, link, notes, horario exato no push/title/body. `refType` `meeting`, `refId`=meetingId; `link` do alerta so na API autenticada. Novo kind em `pushPrefs` (default ligado, D-R12).
7. API de sessao para o web (NAO Bearer mobile), todas com `requireUser`:
   - `GET /api/notifications/summary` -> `{unreadTotal, byArea:{calendario,leads,configuracoes,aprovacoes}}` com ETag/`If-None-Match` (304). Sem PII. Aprovacoes = `Draft` pendentes (`queries/agent.ts`). Mapa kind->area em modulo puro `src/lib/notifications/areas.ts` (`meeting_reminder`->calendario; `handoff`,`lead_replied`->leads; `wa_disconnected`,`wa_paused`,`scheduler_stale`,`budget_*`,`mass_opt_out`->configuracoes; kind desconhecido conta so no total).
   - `GET /api/notifications` (lista, cursor `createdAt,id`, filtros area/kind e lida/nao lida; ultimas 20 por padrao) e `POST /api/notifications/[id]/read`, `POST /api/notifications/read-all` (opcional filtro por area). "Lida" = `readAt`; visitar area nao marca (D-R16).
8. Atualizar `src/lib/openapi.ts` (kind, webhook, rotas de sessao) e contrato mobile (kind `meeting_reminder`). Sem endpoint mobile novo.
9. Metrica `meetings`: manter por `createdAt`, excluir `cancelled` (D-R9). Retencao: `cleanupMobile` ja limpa alertas resolvidos > 30 d; reunioes nao sao apagadas.

## Fora do escopo
Toda UI (SPEC-029); Google/Outlook Calendar, Meet/Zoom (D-R7); ICS e lembrete ao lead (D-R6); criacao por IA (D-R4); recorrencia, multiusuario, participantes; agenda no app mobile (SPEC futura, `GET /api/mobile/v1/meetings` mascarado; app so precisa reconhecer o kind).

## NFR / seguranca / LGPD
- Todas actions/rotas atras de `requireUser`/chave de API; testes `*-auth-coverage.test.ts`.
- PII: texto fixo; `redactText`; logs so ids (`safeErrorForLog`); `notes`/`link` nunca em logs/push. Webhook nao ecoa corpo.
- UTC no banco; timezone IANA validado. Idempotencia: dedupeKey, `externalId`, `clientRequestId`.
- Meeting segue cascata do lead; exclusao LGPD remove Meeting e alertas por `refId`.

## Criterios de aceite
1. Migration aditiva preserva Meetings existentes (`scheduledAt`->`startsAt`, duration->endsAt); metrica do dashboard inalterada em dados antigos.
2. Criar reuniao move a oportunidade a `reuniao_agendada` com StageHistory; cancelar nao move stage e retorna aviso.
3. Reuniao a 24h/1h/15min gera exatamente 1 alerta por janela (5 varreduras nao duplicam); reagendar gera novos e resolve antigos; cancelar resolve pendentes.
4. Cron atrasado emite o lembrete valido mais proximo, nunca um vencido.
5. Push (mock Expo) so com texto fixo; teste de vazamento confirma ausencia de nome/telefone/email/link/notes/horario exato.
6. Webhook cria reuniao autenticada e idempotente; sem chave = 401; excesso = 429 + Retry-After.
7. `GET /api/notifications/summary` exige sessao (401 sem cookie), sem PII, devolve 304 com ETag igual; mark-read/read-all funcionam e refletem no resumo; kind desconhecido so no total.
8. Conflito de horario retorna aviso sem bloquear.
9. typecheck, lint e `npm test` verdes; novos testes contam para a suite.

## Testes obrigatorios
- Dominio: validacoes (fim>inicio, duracao, https, passado), transicoes, conflito (aviso), mover stage.
- Lembretes: janelas, idempotencia, baseline, reagendar/cancelar, `timezone` diferente, teto de pushes, sem PII.
- Tempo/fuso com TZ do processo UTC e Asia/Tokyo (limites de dia 23:30-00:30) onde houver calculo de dia.
- Actions/rotas: auth coverage, zod, 401/429, idempotencia webhook, ETag/304, cursor, mapa kind->area (todos os kinds do `TEXT` cobertos), sem vazamento de segredo.
- Migration no banco de testes (SPEC-020) com dados antigos.
- Push real em aparelho e migrate ponta a ponta com Docker/DB: PENDENTE do usuario (registrar como limitacao).

## Riscos
Migracao sobre dados de producao (aditiva, duas fases); precisao do lembrete de 15 min +-2 min pelo cron; `MobileAlert.readAt` global (mono-usuario); excedente de push fica so no sino/polling.

## Arquivos esperados (indicativo)
prisma/schema.prisma + migration; src/lib/domain/meeting.ts; schemas/meeting.ts; actions/meeting.ts; queries/meetings.ts; mobile/alerts.ts (novo kind); notifications/areas.ts; openapi.ts; src/app/api/integrations/meetings/route.ts; src/app/api/notifications/{route.ts,summary/route.ts,[id]/read/route.ts,read-all/route.ts}; testes.

## Restricoes de implementacao
Ler `node_modules/next/dist/docs/` antes de codar (Next 16). Regras HTTP transversais na saida. Nao alterar decisoes das SPECs 019/023/027. Uma SPEC por vez; SPEC-029 so inicia com esta IMPLEMENTED.

## Implementation Notes
- Migration: `prisma/migrations/20260921100000_meeting/migration.sql` (aditiva). `scheduledAt` RENOMEADO para `startsAt` (dados preservados; consumidores `queries/leads.ts`, `leads/[id]/page.tsx`, seed e `lead.test.ts` ajustados); `endsAt` = startsAt + duration; `duration` mantido (remocao so na fase 2); `status` String -> enum (desconhecido -> scheduled); `campaignId` backfill via Opportunity + FK Campaign; `externalId @unique` (NULLs nao colidem); `MeetingSettings` singleton (`offsetsMin Int[]` default 1440/60/15). Aplicada e validada SOMENTE no banco de teste (`prisma migrate diff` sem drift + teste com dados legados). **NAO aplicada no banco de dev: pendente do usuario (`npm run db:migrate`).**
- Codigo: `src/lib/domain/meeting.ts`, `schemas/meeting.ts`, `actions/meeting.ts`, `queries/meetings.ts`, `mobile/meeting-reminders.ts` (+ integracao em `mobile/alerts.ts`, novo kind em `mobile/schemas.ts`), `meetings/webhook.ts` + `app/api/integrations/meetings/route.ts`, `notifications/{areas,http,summary}.ts`, `app/api/notifications/{route,summary/route,[id]/read/route,read-all/route}.ts`, `openapi.ts`, metricas (`dashboard/metrics.ts`, `mobile/metrics.ts`) excluindo `cancelled`, `test-utils/meeting-fixture.ts`.
- Testes novos: `domain/meeting.test.ts`, `mobile/meeting-reminders.test.ts`, `meetings/webhook.test.ts`, `app/api/notifications/notifications.test.ts`, `actions/meeting.test.ts`, `actions/meeting-auth-coverage.test.ts`, `notifications/areas.test.ts`, `test/meeting-migration.test.ts`. Ajustes em testes existentes: `alerts.test.ts` (escolhe alerta nao lido explicito), `mobile.test.ts` (titulo do teste de OpenAPI), `lead.test.ts`/`dashboard.test.ts` (novos campos/D-R9).
- Resultados (comandos executados): `npm run lint` VERIFIED (0 erros); `npx tsc --noEmit` VERIFIED; `npx vitest run` VERIFIED: 82 arquivos, 1049 testes passando.
- Criterios: AC1 PASS (meeting-migration.test); AC2 PASS (domain/meeting.test: criar move stage + StageHistory; cancelar nao move e avisa); AC3 PASS (meeting-reminders.test: janelas 24h/1h/15min, 5 varreduras, reagendar, cancelar); AC4 PASS (cron atrasado); AC5 PASS (push fixo + teste de vazamento); AC6 PASS (webhook.test: 201/200 idempotente, 401, 429 + Retry-After); AC7 PASS (notifications.test: 401, ETag/304, mark-read/read-all, kind desconhecido so no total); AC8 PASS (conflito so aviso); AC9 PASS.
- Decisoes/interpretacoes: (1) auth do webhook = Bearer `INGEST_SECRET` + `INTEGRATION_LEADS_ENABLED=true` (mesmo padrao do `/api/integrations/leads`; nao ha modelo de chave por integracao para reunioes), rate limit proprio (20 invalidas/min, 300 validas/min), corpo max 16 KB. (2) `unreadTotal` = alertas nao lidos (kind != baseline, como o contador mobile); `byArea.aprovacoes` = Draft pendentes e NAO entra em `unreadTotal`. (3) Baseline de lembrete: reuniao com `updatedAt` posterior ao inicio da janela, ou `MeetingSettings.updatedAt` posterior, nasce lida e sem push. (4) Emite so o menor offset aberto; todos os offsets abertos ficam ativos (nao resolve o anterior ate a reuniao comecar/cancelar/reagendar). (5) `clientRequestId` vira `externalId="client:<id>"`; webhook usa `wh:<externalId>`. (6) `/api/notifications/*` fica DENTRO da guarda do proxy (sessao) e valida sessao na rota (401 JSON); POSTs recusam `Origin` de outro host (403). (7) OpenAPI: rotas da SPEC-028 declaradas com `servers: [{url:"/api"}]` por path; cookie de sessao descrito em texto (o teste SPEC-021 proibe a palavra `apiKey`). (8) Transicoes (done/no_show/cancel) so a partir de `scheduled`; idempotentes se ja no estado pedido. (9) `sweepThrottled` tambem roda nas rotas web `summary` e lista (1x/60 s), como nas rotas mobile.
- Limitacoes conhecidas: push real em aparelho e migrate no banco de dev PENDENTES do usuario; `deleteLead` continua bloqueando leads com Meeting (comportamento SPEC-008 inalterado; exclusao LGPD com remocao de Meeting/alertas por `refId` nao foi implementada porque nao existe fluxo de exclusao LGPD no codigo); `MobileAlert.readAt` global (mono-usuario); precisao do lembrete de 15 min depende do cron (1-2 min); seed anterior gera reunioes `scheduled` que podem gerar lembretes reais quando proximas.
