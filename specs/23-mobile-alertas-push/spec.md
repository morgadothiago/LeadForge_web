# SPEC-023 — Mobile: alertas e notificacoes push (backend)
- status: DRAFT | domain: backend | agente: dev-backend | depende de: SPEC-021, SPEC-022 (e 011, 013, 017, 019) | bloqueia: 026 (push no app)
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
