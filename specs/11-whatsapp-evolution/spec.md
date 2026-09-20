# SPEC-011 — WhatsApp (provider plugavel; Evolution como 1a implementacao)
- status: IMPLEMENTED (QA aprovado + correcoes verificadas; Evolution real e navegador PENDENTES)| domain: fullstack | sessao: 2 | ordem: 12 | depende de: SPEC-001, SPEC-005, SPEC-000 (docker)
## Escopo
**Decisao do usuario (2026-09-19): trocar de provider deve ser facil (risco de banimento Baileys).** Todo o app fala SO com a interface `WhatsAppProvider` (`src/lib/whatsapp/provider.ts`): `createInstance`, `getQr`, `getStatus`, `sendText`, `parseWebhook(request) -> InboundMessage | StatusEvent | null`, `verifyWebhook(request)`. Implementacao `EvolutionProvider` em `src/lib/whatsapp/providers/evolution.ts`; registro `getWhatsAppProvider(instance.provider)` por factory. Nenhum import de Evolution fora de `providers/`. `WhatsAppInstance.provider` (enum: evolution | cloud_api | ...) define qual usar. Webhook (SPEC-012) chama `provider.parseWebhook`, nunca formato Evolution direto. Trocar = novo arquivo em `providers/` + valor no enum, sem tocar scheduler/webhook/UI.
Backend: client Evolution tipado (Zod nas respostas) — criar instancia, obter QR, status, `sendText` com delay 1-3s; regras: horario 8h-18h no fuso do lead (funcao pura `isWithinSendWindow(lead.timezone, now)`), validacao BR, sem envio fora da janela (reagenda `scheduledAt`). Webhook token por instancia gerado (`webhookToken`). apiKey da instancia cifrada.
Frontend: Configuracoes > WhatsApp: listar instancias, criar, exibir QR (polling de status), vincular a campanha (SPEC-005).
## Criterios de aceite
- [ ] Interface `WhatsAppProvider` + factory; teste com provider fake prova que scheduler/webhook funcionam sem Evolution.
- [ ] grep: nenhum import de `providers/evolution` fora da factory.
- [ ] Client testado com fetch mockado (sucesso, 4xx, timeout).
- [ ] `isWithinSendWindow` testada (limites 07:59, 08:00, 17:59, 18:00, fusos diferentes, DST).
- [ ] Envio fora da janela nao chama a API e reagenda.
- [ ] Teste ponta a ponta com Evolution real: PENDENTE (docker/colima parado; requer QR/telefone real).
- [ ] build/lint/typecheck OK.
## Riscos
Baileys nao-oficial: risco de banimento do numero; recomendar aquecimento e limites. Cold outreach sujeito a LGPD.

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (client Evolution): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.

## Decisoes e salvaguardas (fechadas ao aprovar)
- Anti-banimento (Baileys nao-oficial): `WhatsAppInstance.dailyLimit` (default 30/dia, conservador p/ numero novo), intervalo aleatorio 20-60s entre mensagens da mesma instancia (alem do `delay` de digitacao 1-3s da API), janela 8h-18h no fuso do lead, sem envio para lead sem `phone` valido (E.164 BR) ou `optedOutAt`; contagem diaria por Touch whatsapp `sent` (America/Sao_Paulo) como no e-mail; excedente -> reagenda proximo dia 08:00, sem falhar.
- Reserva atomica do Touch (`sending`, updateMany) e recuperacao de crash em 15 min, igual ao e-mail (SPEC-010); o scheduler (SPEC-013) ainda deve serializar por instancia.
- baseURL do provider vem SO de env (`EVOLUTION_API_URL`), nunca de input de usuario (sem SSRF); apiKey por instancia cifrada com `src/lib/crypto/secret-box.ts`; nunca em logs/respostas (usar `hasApiKey`).
- Client HTTP via `createHttpClient` (SPEC-016): axios+interceptor, 429/Retry-After, erros `AppError` PT-BR.
- Todas as actions/queries: safeAction + requireUser + Zod PT-BR; teste de cobertura de sessao como em email.

## Backend (implementado 2026-09-19; status da SPEC continua APPROVED ate o frontend fechar)
### Contrato para a SPEC-012 (receiver)
- URL do webhook (CORRIGIDO por D17, 2026-09-19): `buildWebhookUrl(instance)` = `{APP_BASE_URL || AUTH_URL}/api/webhooks/whatsapp/{webhookToken}` (token por instancia, 32 bytes base64url, NO CAMINHO). O webhook e configurado POR INSTANCIA em `/instance/create` (`webhook.url`, `byEvents:false`, `events`) e reconfigurado em `/webhook/set/{instance}` (`provider.configureWebhook`, usado na rotacao). Cabecalhos customizados NAO sao usados (nao verificados na v2.1.1). A URL contem o segredo: nunca logar (`redactWebhookToken`).
- Fluxo do receiver (ver SPEC-012): instancia localizada pelo token do caminho (`WhatsAppInstance.webhookToken` @unique) -> `provider.verifyWebhook(req, { webhookToken, apiKey }, token)` (async; tempo constante; 2o fator: `apikey` do corpo vs apiKey da instancia, ausente nao reprova) -> `parseWebhook` (`req.clone()`; malformado -> AppError validation -> 400) -> processar. Provider via `getWhatsAppProvider(instance.provider)`.
- `EVOLUTION_WEBHOOK_SECRET`: REMOVIDO/DEPRECIADO (nao lido). Webhook GLOBAL desligado no docker-compose (`WEBHOOK_GLOBAL_ENABLED=false`; `WEBHOOK_GLOBAL_URL`/`BY_EVENTS` removidos): o webhook agora e por instancia.
### Tipos (`src/lib/whatsapp/provider.ts`)
- `InboundMessage { kind:"inbound", instanceName, from(E.164), pushName|null, text, externalId, timestamp }`; `StatusEvent = {kind:"connection", instanceName, status: connected|connecting|disconnected} | {kind:"qrcode", instanceName, qrCode} | {kind:"message_status", instanceName, externalId, status: sent|delivered|read|failed}`; `WebhookEvent = InboundMessage | StatusEvent`.
- `WhatsAppProvider { createInstance, getQr, getStatus, sendText, deleteInstance?, logoutInstance?, configureWebhook({instanceName, webhookUrl}), parseWebhook(request), verifyWebhook(request, {webhookToken, apiKey?}, presentedToken): Promise<boolean> }`; `getWhatsAppProvider(kind)`. `FakeWhatsAppProvider` em `providers/fake.ts` (so testes).
### Regras implementadas
- `sendText`: delay 1200-3000ms aleatorio; POST sem retry automatico (5xx/429/timeout viram `AppError`); timeout no envio -> Touch `failed` com aviso "verifique antes de reenviar".
- `sendWhatsApp(touchId, {now?, provider?, rng?})` (`src/lib/channels/whatsapp.ts`): reserva atomica + recuperacao 15 min; ordem: optout/completed -> telefone valido -> template -> janela do lead (fora: `scheduled` em `nextWindowStart`, sem chamar API) -> instancia da campanha e `connected` (senao deferred +5min) -> dailyLimit (dia SP; excedente: proximo 08:00 SP ajustado a janela do lead) -> intervalo minimo 20-60s por instancia (`nextAllowedSendAt`, deferral) -> envio. 429: Touch `scheduled` em now+max(Retry-After,60s). Resultado: `sent | already_sent | skipped | deferred{reason} | failed`.
- Schema: `WhatsAppInstance.dailyLimit(30)`, `lastError`, `lastConnectedAt`; `Touch.whatsappInstanceId` (SetNull) + indice `(whatsappInstanceId,status,sentAt)`. Migration `whatsapp_instance_settings`.
- Actions (`src/lib/actions/whatsapp.ts`): `createWhatsAppInstance`, `getInstanceQr`, `refreshInstanceStatus`, `updateInstance`, `deleteWhatsAppInstance` (bloqueia com campanhas), `disconnectInstance`, `getInstanceWebhookConfig` (unica saida do token completo; retorna `{ url, token }`, sem `header`), `rotateWebhookToken` (SPEC-012). Queries: `listWhatsAppInstances`, `getWhatsAppInstance` (`hasApiKey`, `webhookTokenHint` = 4 ultimos). apiKey cifrada (secret-box). Rota a revalidar: `/configuracoes/whatsapp`.
### Criterios (backend)
- PASS: interface+factory+fake (`provider.test.ts`, `channels/whatsapp.test.ts`); grep sem import de evolution (`provider.test.ts`); client sucesso/4xx/429/5xx/timeout/Zod/segredos (`providers/evolution.test.ts`); janela 07:59/08:00/17:59/18:00/fusos/DST (`send-window.test.ts`); fora da janela nao chama API e reagenda; sessao (`whatsapp-auth-coverage.test.ts`); typecheck/lint/test/build.
- PENDENTE: ponta a ponta com Evolution real (QR/telefone); formatos reais de `messages.update`/`hash` da v2.1.1 nao validados contra a API real; frontend (Configuracoes > WhatsApp).

## Frontend (implementado 2026-09-19)
### Criterios de UI
- [x] Configuracoes > WhatsApp (`/configuracoes/whatsapp`): aba habilitada, lista (nome, numero formatado, provedor, status com badge+texto, limite, campanhas, `hasApiKey`, `lastError`, ultima conexao), vazio, skeleton.
- [x] Criar/editar em Dialog (mascara BR, erro por campo, limite 1-200, aviso de aquecimento/banimento/chip dedicado).
- [x] QR: `getInstanceQr` + `<img>` so com `data:image/png;base64,` validado (`safeQrSrc`); polling de `refreshInstanceStatus` com backoff (3s->10s), teto de 60 tentativas, 3 erros seguidos param, pausa com aba oculta, para ao conectar/desmontar; aria-live; expiracao (60s) com "Gerar novo QR".
- [x] Atualizar status, desconectar e excluir (ConfirmDialog mostra `_form` de bloqueio por campanhas).
- [x] Webhook sob demanda ("Mostrar URL do webhook"), mascarado, revelar/copiar com feedback, aviso de segredo/logs/`APP_BASE_URL`; "Gerar novo token" (ConfirmDialog) mostrando URL mascarada + `tokenHint`.
- [x] CampaignForm: select lista instancias reais com status; hint atualizado.
- Logica pura testada: `whatsapp-format.test.ts`, `qr-poll.test.ts`. Ainda NAO verificado no navegador nem contra Evolution real.
### Implementation Notes
Arquivos: `src/components/settings/{WhatsAppInstanceList,WhatsAppInstanceFormDialog,WhatsAppQrDialog,WhatsAppWebhookSection,WhatsAppCreateButton,whatsapp-format,qr-poll}`, `src/app/(app)/configuracoes/whatsapp/{page,loading}.tsx`, `SettingsTabs.tsx`, `CampaignForm.tsx` + paginas de campanha (passam `listWhatsAppInstances`). Editar instancia reenvia o numero (o backend valida); nome nao editavel.

## Implementation Notes - correcoes do QA (2026-09-19)
- M1 `providers/evolution.ts`: sem `key.id`, id sintetico = hash(jid|timestamp|texto|bucket de 2 s do instante de RECEBIMENTO), so com timestamp; sem `key.id` e sem timestamp = id aleatorio `r_<uuid>` (processa sempre). Com `key.id`, reentrega continua idempotente. Trade-off: reentrega sem key.id apos >2 s nao e deduplicada. Testes em `evolution.test.ts`.
- M3 parse de `connection.update` expoe `loggedOut` (statusReason/reason 401 ou "loggedOut", tolerante). PENDENTE: formato REAL na v2.1.1 nao verificado.
- B10 `deleteWhatsAppInstance`: valida bloqueio, apaga no banco em transacao e SO ENTAO chama o provider em best-effort (falha vira log sem segredo; instancia orfa no provider deve ser removida a mao; alerta nao e possivel pois InstanceAlert cai em cascade).

### Verificacao E2E 2026-09-19 (Evolution v2.1.1 real, sem WhatsApp real)
- OK contra a API real: `ping` (fetchInstances), `createInstance` (devolve `hash` -> apiKey da instancia), `getStatus` (`connecting`), `configureWebhook` (`/webhook/set`), `deleteInstance`; webhooks reais recebidos pelo receiver.
- NAO VERIFICAVEL / bloqueio: QR nunca foi gerado (`getQr` -> `{"count":0}`, create sem `qrcode.base64`); a Evolution entra em loop `connection.update` state `close` statusReason 405 (rejeicao de versao do WhatsApp Web pelo Baileys da v2.1.1; hipotese: falta `CONFIG_SESSION_PHONE_VERSION` no docker-compose). `checkNumbers` (`/chat/whatsappNumbers`) estourou timeout com instancia nao pareada. `sendText`, `messages.update` e logout reais permanecem PENDENTES.
