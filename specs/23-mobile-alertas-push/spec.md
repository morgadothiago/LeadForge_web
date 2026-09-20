# SPEC-023 — Mobile: alertas e notificacoes push (backend)
- status: IMPLEMENTED (backend; push real em aparelho PENDENTE) (aprovada pelo usuario, 2026-09-19) | domain: backend | agente: dev-backend | depende de: SPEC-021, SPEC-022 (e 011, 013, 017, 019) | bloqueia: 026 (push no app)
## Objetivo
Gerar alertas de monitoramento deduplicados, expo-los por API (polling) e entregar push opcional, sem PII no corpo.
## Eventos (fonte existente)
| Evento | Fonte | Severidade |
|---|---|---|
| WhatsApp desconectou | `WhatsAppInstance.status/disconnectedAt` | alta |
| Possivel banimento / instancia pausada | health/`pausedReason`, `InstanceAlert` | critica |
| Possivel opt-out em massa | `InstanceAlert` kind possible_opt_out / taxa de Suppression | alta |
| Handoff do Closer ("Precisa de voce") com link da call | Lead `needsHuman`/`handoffReason`; link de call vem do fluxo de reuniao (`Meeting`) | alta |
| Orcamento de agentes 80% / 100% | `budgetState` | media / alta |
| Scheduler parado | `stale` (SPEC-022) | alta |
| Lead respondeu | Touch inbound | baixa (agrupavel; opt-in por dispositivo) |
## Modelo (proposto)
`MobileAlert`: id, kind, severity, dedupeKey (unique por janela, ex.: `wa_disconnected:{instanceId}:{episodio}`), title, body (SEM PII), refType/refId (`instance|lead|draft|scheduler|budget`), createdAt, readAt?, resolvedAt?. `MobileDevice.pushToken`, `pushPrefs` (JSON por kind, silencio noturno opcional). Retencao 30 dias (job de limpeza).
- Geracao: funcao `raiseAlert()` idempotente chamada nos pontos existentes (tick do scheduler, webhook, health) ou por varredura no tick; nunca bloqueia o fluxo principal (falha de alerta so loga).
- Resolucao automatica quando a condicao some (ex.: instancia reconectou).
## API
`GET /alerts?unread=&cursor=`, `POST /alerts/{id}/read`, `POST /alerts/read-all`, `PUT /devices/push-token` (token + prefs), `GET /alerts/unread-count`.
## Push: avaliacao (gratuito primeiro)
| Opcao | Custo | Notas |
|---|---|---|
| Polling (foreground, 60 s; `unread-count`) | zero | Sem infra; nao acorda o app fechado; e o fallback obrigatorio. |
| Expo Push Service (`expo-notifications`) | gratis (com limites de taxa) | Simples; exige FCM (Android, gratis) e APNs (iOS: conta Apple Developer paga ~US$99/ano) em build real; Expo Go tem restricoes (verificar na doc atual: push remoto no Expo Go/Android foi limitado a partir do SDK 53). Envio server-side via `expo-server-sdk`/HTTP com axios (regra transversal SPEC-016). |
| FCM direto | gratis | So Android sem Expo push; mais trabalho; nao recomendado agora. |
Recomendacao (D-M4): polling desde o dia 1 + Expo Push como camada opcional ligada por flag `MOBILE_PUSH_ENABLED`; iOS push so quando houver conta Apple.
- Corpo do push generico: titulo do tipo ("WhatsApp desconectou", "Precisa de voce", "Orcamento em 80%") e corpo sem nome/telefone/mensagem; detalhes so ao abrir o app autenticado. `data` leva apenas `alertId`.
- Tratar recibos/tickets do Expo: `DeviceNotRegistered` = limpar token; 429/5xx com backoff (SPEC-016); throttle: max 1 push por `dedupeKey`, resumo agrupado para "lead respondeu" (max 1/5 min).
## Criterios de aceite
1. Mesmo episodio nao gera alerta duplicado (dedupe); novo episodio gera.
2. Cada evento da tabela gera alerta com severidade correta a partir de fixtures.
3. Alerta resolve sozinho quando a condicao termina.
4. Push nunca contem nome, telefone, e-mail ou texto de mensagem (teste com lead de exemplo varrendo payload).
5. Token invalido/`DeviceNotRegistered` limpa `pushToken`; falha do Expo nao derruba o tick.
6. Com `MOBILE_PUSH_ENABLED=false` nenhuma chamada externa; polling continua funcionando.
7. `read`/`read-all` idempotentes; contagem de nao lidos correta; retencao remove > 30 dias.
8. Dispositivo revogado (SPEC-021) para de receber push e alertas.
## Testes obrigatorios
Vitest: dedupe, resolucao, cada gatilho, payload sem PII, ticket/recibo, flag, retencao, 429 do Expo com/sem Retry-After (regra transversal).
## Seguranca / LGPD
Sem PII em push (passa por servidores Expo/Apple/Google); `pushToken` e dado do dispositivo, apagado no logout/revogacao; alertas com retencao.
## Fora do escopo
UI do app (024-026); e-mail/SMS como canal de alerta.
## Limitacoes de validacao
Push real exige aparelho fisico + build (nao Expo Go em alguns casos) e, no iOS, conta Apple: marcar PENDENTE ate haver hardware/contas; validar com Expo push tool e fake HTTP.

## Implementation Notes
- Arquivos: `prisma/migrations/20260920100000_mobile_alert` (+ `MobileAlert`, `MobileDevice.pushPrefs`), `src/lib/mobile/{alerts,expo-push}.ts`, `schemas.ts` (pushTokenSchema), rotas `src/app/api/mobile/v1/alerts/{route,unread-count,read-all,[id]/read}` e `devices/push-token` (PUT/DELETE), `openapi.ts` (5 paths novos, sem planned), `scheduler/run-tick.ts` (1 chamada isolada `sweepThrottled`), logout/refresh-reuso/revogacao remota agora apagam `pushToken`.
- Testes: `src/lib/mobile/alerts.test.ts` (21). `npm test` 947/947 VERIFIED; tsc e eslint limpos.
- Criterios: AC1 dedupe/novo episodio PASS; AC2 cada evento com severidade PASS (fixtures); AC3 resolucao automatica PASS; AC4 payload sem PII PASS; AC5 DeviceNotRegistered limpa token e falha do Expo nao derruba PASS; AC6 flag off = zero chamadas PASS; AC7 read/read-all idempotentes, contagem, retencao 30d PASS; AC8 revogado = 401 e nao recebe push PASS. 429 com/sem Retry-After e retry limitado PASS (adapter falso).
- Decisoes: geracao por VARREDURA idempotente (`sweepAlerts`) no fim do tick (throttle 60 s) e lazily em GET /alerts e /unread-count (cobre "scheduler parado", quando o tick nao roda); nenhum arquivo de agentes/webhook/health alterado. Alertas sao GLOBAIS (web single-tenant; readAt unico, nao por dispositivo). Titulo/corpo sao texto fixo por kind. Campo `link` (https, do `Agent.callLink` do Closer) foi adicionado ao modelo para o handoff; so trafega na API autenticada, nunca no push. Opt-out em massa = >= 5 supressoes por opt-out em 24h (o kind `possible_opt_out` de InstanceAlert nao existe no codigo). "Instancia pausada" usa `health=paused`. Orcamento por agente e global (`alert`=80%, `exhausted`=100%). "Lead respondeu" agrupado em janelas de 5 min; push desse kind so com opt-in em `pushPrefs`. Retencao: alertas > 30 dias e dispositivos revogados ou com refresh expirado ha > 30 dias sao apagados (limpeza no maximo 1x/h, dentro da varredura). `MOBILE_PUSH_ENABLED=true` liga o push; cliente axios unico (`createHttpClient`, retry 3, 429/Retry-After); logs passam por `redactText`.
- Limitacoes: recibos do Expo (2a etapa) nao consultados, so tickets imediatos; silencio noturno (opcional) nao implementado; deteccao do evento tem latencia de ate ~1-2 min (tick) e nao ha gancho no webhook; push real (FCM/APNs) e validacao em aparelho PENDENTES; sem escopo por usuario (single-tenant).
- Limites conhecidos (QA L4/I1): o throttle de varredura (`lastSweep`/`lastCleanup`) e em memoria POR PROCESSO (varias instancias varrem mais vezes; o dedupe por `dedupeKey` unico mantem a idempotencia). `alerts/read-all` e `read` sao GLOBAIS por o web ser single-tenant.
- Correcoes de QA:
  - M1a baseline: a primeira varredura (linha de controle `MobileAlert` kind `baseline`, dedupeKey `baseline:init`, ausente) cria todo estado ja existente como alerta LIDO e SEM push; a linha e criada na mesma varredura, nunca aparece em `GET /alerts` (filtrada por kind) e nao e apagada pela limpeza. Novos episodios depois geram push normal.
  - M1b push fora do caminho critico: a varredura junta os pushes, envia no maximo 10 por varredura (`MAX_PUSHES_PER_SWEEP`) em background com catch e espera no maximo 3 s (`PUSH_WAIT_CAP_MS`); o restante segue sem bloquear tick/GET /alerts. `raiseAlert` direto continua aguardando o push.
  - L1: `cleanupMobile` apaga so alertas RESOLVIDOS > 30 dias; episodio continuo nao resolvido e mantido (dedupe preservado, sem novo push).
  - L2: `redactText` cobre `cookie:`/`set-cookie:` e `secret|senha|password|token` + `is|e|:|=` + valor.
  - L3: comentario do AC7 em `metrics.ts` corrigido para 3 queries.
  - Testes novos: baseline (55 handoffs + instancia desconectada => 0 pushes; novo evento => 1), teto de 10, Expo travado nao passa do teto, retencao com episodio ativo, redactText L2.
