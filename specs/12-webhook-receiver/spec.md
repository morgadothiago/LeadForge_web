# SPEC-012 — Webhook receiver (WhatsApp)
- status: IMPLEMENTED (QA aprovado + correcoes verificadas; Evolution real e navegador PENDENTES)| domain: backend | sessao: 2 | ordem: 13 | depende de: SPEC-001, SPEC-011
## Escopo
`POST /api/webhooks/whatsapp` (Route Handler; ler docs Next 16 sobre route handlers). Valida segredo (header/apikey ou token na URL por instancia — o PROMPT so tem EVOLUTION_WEBHOOK_SECRET [D17]), Zod no payload, idempotencia via WebhookEvent. Eventos: MESSAGES_UPSERT (fromMe=false -> localiza Lead por telefone normalizado -> cria Touch inbound, `sequenceStatus=paused_replied`, repliedAt, stage conforme D4), opt-out ("parar","sair","nao quero", normalizado sem acento/caixa) -> opted_out + stage perdido; MESSAGES_UPDATE (delivered/read no Touch), CONNECTION_UPDATE, QRCODE_UPDATED (atualiza WaStatus). Ignora fromMe e grupos (@g.us). Lead nao encontrado -> 200 e log.
## Criterios de aceite
- [ ] Sem/segredo errado -> 401; payload invalido -> 400.
- [ ] Payload de exemplo do PROMPT pausa a sequencia e cria Touch inbound (teste de integracao).
- [ ] Mesmo evento 2x nao duplica.
- [ ] Opt-out detectado em variantes ("PARAR", "Não quero").
- [ ] Responde rapido (<1s) sem chamadas externas sincronas.
- [ ] build/lint/typecheck OK.
## Decisoes pendentes
D17, D4. Nota: opt-out por substring pode gerar falso positivo ("nao quero parar de..."); definir match por mensagem curta/palavra exata [D18].

## Nota (decisao do usuario)
Webhook deve usar `WhatsAppProvider.parseWebhook`/`verifyWebhook` (SPEC-011), nunca parsear formato Evolution direto, para permitir troca de provider.

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (429 + Retry-After no receiver): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.

## Decisoes (2026-09-19)
- D4 (usuario): resposta por WhatsApp -> Touch inbound, `repliedAt`, `sequenceStatus=paused_replied` e mover a Opportunity para `interessado` (via `runMoveOpportunity` de src/lib/domain/move-opportunity.ts; StageHistory na mesma transacao). Opt-out -> `opted_out` + `perdido` (lostReason "Opt-out por WhatsApp") e encerra touches pendentes.
- D18 (usuario): opt-out por MENSAGEM CURTA EXATA: texto inteiro normalizado (minusculas, sem acento, sem pontuacao/emoji, trim) igual a um item da lista (parar, pare, sair, cancelar, remover, descadastrar, nao quero, nao quero mais, stop). Frases longas como "nao quero parar de conversar" viram resposta normal. Lista em constante testada.
- D17 [CONFIRMADO pelo usuario]: token POR INSTANCIA no caminho da URL (`/api/webhooks/whatsapp/[token]/[[...evento]]`, pois `webhook_by_events` anexa o nome do evento ao path), comparacao em tempo constante contra `WhatsAppInstance.webhookToken`; 2o fator: se o corpo trouxer `apikey`, comparar com a apiKey da instancia. Webhook configurado POR INSTANCIA na criacao (SPEC-011) e webhook GLOBAL desligado no docker-compose (`WEBHOOK_GLOBAL_ENABLED=false`).

## Evidencia sobre o Evolution API (fonte: controller de webhook no branch main; NAO verificada na v2.1.1 fixada)
- Sem assinatura HMAC no corpo. Corpo: `event, instance, data, destination, date_time, sender, server_url, apikey`.
- Headers customizados por instancia; com `jwt_key` vira `Authorization: Bearer <JWT>` (exp 10 min). Nao depender disso sem testar na versao fixada.
- Webhook global usa URL unica (incompativel com token por instancia).
- Verificar na v2.1.1 antes de fechar a SPEC: formato exato dos eventos (`messages.upsert`), `apikey` no corpo e `webhook_by_events`; marcar como PENDENTE se nao for possivel testar sem Evolution real.

## Escopo adicional aprovado (melhorias)
1. Resposta visivel: o Kanban e a ficha do lead mostram "respondeu em <data>" e o texto da ultima mensagem inbound (query aditiva; sem quebrar contratos existentes de getPipelineBoard/getLead; truncar texto, escapar sempre como texto).
2. Possivel opt-out: frases com padrao forte de recusa (ex.: "para de me mandar", "nao me envie", "me tira da lista", "remover meu numero", "nao tenho interesse em receber") NAO movem para perdido sozinhas; marcam `Lead.possibleOptOut Boolean @default(false)` (migration) e aparecem como alerta "Possivel opt-out: revise antes de contatar" no card/ficha; acao manual "Confirmar opt-out" (mesmo efeito do opt-out automatico) e "Descartar alerta". Lista de padroes em constante testada, normalizada sem acento/caixa.
3. Rotacao do token: action `rotateWebhookToken(instanceId)` (em src/lib/actions/whatsapp.ts, safeAction+requireUser) gera novo token aleatorio, reconfigura o webhook no provider e invalida o antigo; botao "Gerar novo token" na tela Configuracoes > WhatsApp. O token na URL e segredo: nunca logar a URL completa (redigir o token em logs/erros).
4. Route Handler `/api/webhooks/whatsapp/[token]/[[...evento]]`: 401 sem segredo valido (resposta igual para token inexistente/errado, sem revelar qual), 400 payload invalido (Zod via provider.parseWebhook), 429 + Retry-After com rate limit por token e global (reuse padrao de src/lib/channels/unsubscribe-rate-limit.ts e tooManyRequests), idempotencia via WebhookEvent (eventId unique; chave estavel derivada de instance+message id/timestamp), resposta rapida (<1s) sem chamada externa sincrona, lead nao encontrado -> 200 e log sem PII, ignora fromMe e grupos. Desligar `WEBHOOK_GLOBAL_ENABLED` no docker-compose e configurar webhook por instancia na criacao.

## Backend (implementado 2026-09-19; status segue APPROVED ate o frontend fechar)
### Rota
`POST /api/webhooks/whatsapp/{token}/[[...evento]]` (`src/app/api/webhooks/whatsapp/[token]/[[...evento]]/route.ts` -> `handleWhatsAppWebhook` em `src/lib/whatsapp/webhook-handler.ts`). Publica (proxy exclui /api/webhooks). Demais metodos: 405 (verificado por curl no build de producao). O sufixo `[[...evento]]` (webhook_by_events) e ignorado; o evento vem do corpo.
Ordem: formato do token (43 chars base64url) -> instancia por `webhookToken` (@unique) -> `verifyWebhook` (tempo constante + `apikey` opcional) -> rate limit -> `parseWebhook` -> conferencia `event.instance == instanceName` -> processamento. Sem chamada externa sincrona (so banco).
Respostas: 401 `{error:"unauthorized",message:"Não autorizado."}` IGUAL para token malformado/inexistente/errado/apikey errada/instancia divergente; 400 `invalid_payload`; 413 corpo > 1MB; 429 + `Retry-After` (`tooManyRequests`); 200 `{ok:true,result}` com result = ignored | status_updated | duplicate | lead_not_found | status | reply | opt_out | possible_opt_out; 500 generico. Rate limit (`src/lib/whatsapp/webhook-rate-limit.ts`, padrao de unsubscribe-rate-limit generalizado; por processo): balde `invalid` 120/min (tokens malformados/inexistentes, chave unica, nunca uma chave por token forjado), `global` 1500/min e por token 300/min (so tokens existentes). Invalidos nao consomem cota do trafego legitimo.
Token nunca em log/erro/`WebhookEvent`: `redactWebhookToken`; `WebhookEvent.payload` guarda so `{kind, instance, externalId}` (sem texto/telefone). Idempotencia: `WebhookEvent.eventId` unique = `wa:{instanceId}:upsert:{msgId}` ou `wa:{instanceId}:update:{msgId}:{status}` (criado na mesma transacao Serializable, ate 3 tentativas em P2034; P2002 = duplicado -> 200). connection/qrcode nao usam WebhookEvent (idempotentes por natureza).
### Regras (`src/lib/domain/whatsapp-inbound.ts`, `whatsapp-optout.ts`)
- Lead: por `phone` E.164. Mesmo telefone em varias campanhas: `pickLead` ordena por (1) relacao com ESTA instancia (campanha vinculada ou ja recebeu envio dela), (2) sequencia `active`, (3) ultimo envio da instancia, (4) lead mais novo. Sem lead -> 200 + log sem PII.
- Resposta: Touch inbound (`channel whatsapp`, `direction inbound`, `status replied`, `content`=texto ate 4000, `externalId`, `whatsappInstanceId`), `repliedAt`; `active|not_started` -> `paused_replied` + `nextTouchAt=null` (`opted_out`/`completed`/`paused_replied` preservados); touches pending/scheduled -> skipped; Opportunity `novo_lead|contactado|em_followup` -> `interessado` (StageHistory, via `moveOpportunityInTx`, a mesma logica de `runMoveOpportunity`, na MESMA transacao). `interessado|reuniao_agendada|fechado` nao regridem; `perdido` NAO reabre: so registra a resposta (o front destaca por `lastInboundAt` no card perdido; nao ha flag propria).
- Opt-out (D18): texto inteiro normalizado (minusculas, sem acento/pontuacao/emoji, espacos colapsados) IGUAL a `OPT_OUT_EXACT` -> `opted_out`+`optedOutAt`, touches pendentes skipped, Opportunity -> `perdido` ("Opt-out por WhatsApp"); `fechado`/`perdido` ja existentes nao sao movidos (nao sobrescreve venda/motivo). Padroes fortes (`POSSIBLE_OPT_OUT_PATTERNS`, por palavras inteiras) -> `possibleOptOut=true`, pausa, NAO move estagio.
- `message_status`: delivered/read avancam `sent -> delivered` (nunca regride); failed so a partir de `sent`. `connection.update` -> `WaStatus` (+`lastConnectedAt`, `lastError=null` ao conectar); `qrcode.updated` -> `connecting` (QR nao e armazenado; usar `getInstanceQr`).
- Payload de exemplo do PROMPT nao tem `key.id`: o provider gera id sintetico estavel (`h_` + sha256 de jid|timestamp|texto).
### Contrato para o frontend (aditivo; campos opcionais)
- Actions novas (`src/lib/actions/whatsapp.ts`, safeAction+requireUser): `rotateWebhookToken(instanceId): ActionResult<{ webhookUrl: string /* MASCARADA: .../whatsapp/…abcd */; tokenHint: string /* "…abcd" */ }>` (reconfigura o provider ANTES de gravar; falha no provider = token antigo segue valido; falha ao gravar reverte o provider); `confirmOptOut(leadId): ActionResult<{id}>`; `dismissPossibleOptOut(leadId): ActionResult<{id}>`. Revalidam `/leads`, `/leads/{id}`, `/pipeline`, `/`.
- MUDOU: `getInstanceWebhookConfig(id)` agora retorna `{ url, token }` (removido `header`; `url` ja contem o token; unica saida do token completo). `buildWebhookUrl(instance, env?)` mudou de assinatura.
- Tipos: `BoardCard` (getPipelineBoard), `LeadListItem` (listLeads), `LeadDetail` (getLead) ganharam `lastInboundAt?: Date | null`, `lastInboundText?: string | null` (<=200 chars, sem HTML; renderizar como texto), `possibleOptOut?: boolean`. Banco: `Lead.possibleOptOut Boolean @default(false)`, `WhatsAppInstance.webhookToken @unique` (migration `20260919170000_whatsapp_webhook_receiver`).
- Configuracao: URL para o Evolution = `getInstanceWebhookConfig().url`; requer `APP_BASE_URL` alcancavel pelo Evolution. docker-compose: `WEBHOOK_GLOBAL_ENABLED=false`.
### PENDENTE / riscos
- NAO verificado contra Evolution v2.1.1 real: formato de `/webhook/set/{instance}` (usamos `{webhook:{enabled,url,byEvents:false,base64:false,events}}`), `apikey` no corpo, `messages.update` e nomes de evento. Testes usam payloads fixos, sem rede.
- Rate limit em memoria por processo (reinicia no deploy; multi-instancia nao compartilha).
- Front pendente (tela Configuracoes > WhatsApp "Gerar novo token", card/ficha "respondeu em", alerta Possivel opt-out, botoes Confirmar/Descartar). Criterios de aceite ficam para marcar quando o front fechar; backend coberto por `webhook-handler.test.ts`, `whatsapp-optout.test.ts`, `whatsapp-webhook-actions.test.ts`.

## Frontend (implementado 2026-09-19)
### Criterios de UI
- [x] Card do Kanban, lista e ficha de leads: "Respondeu <relativo>" (`<time>` com data completa) + ultimo texto inbound truncado, sempre como texto, `title` com o completo, so com `lastInboundAt`.
- [x] Alerta "Possivel opt-out: revise antes de contatar" (role=status, cor de aviso, icone) no card e na ficha; "Confirmar opt-out" (ConfirmDialog) e "Descartar alerta", toasts, `router.refresh()`, erros `_form`; botoes fora da alca de arrasto. Na lista aparece so como aviso (sem botoes; a linha inteira e link).
- [x] Tela Configuracoes > WhatsApp com "Gerar novo token" (ver SPEC-011).
- Testes: `reply-format.test.ts`. Nao verificado no navegador.
### Implementation Notes
`src/components/leads/{InboundReply,PossibleOptOutAlert,reply-format}`, `PipelineCard.tsx` (li com flex-wrap, alerta em linha propria), `LeadsTable.tsx`, `leads/[id]/page.tsx`.

## Implementation Notes - correcoes do QA (2026-09-19)
- M1: ver notas da SPEC 11 (id sintetico sem key.id; testes de 2 "sim" em instantes distintos = 2 eventos; sem key.id nem timestamp processa).
- B4 `webhook-handler.ts`: corpo lido do stream com teto REAL de 1 MB (`readBodyLimited`) antes de verify/parse; 413 mesmo sem content-length (chunked); verify/parse recebem copia ja limitada (nunca releem corpo ilimitado). Teste com corpo chunked de 5 MB.
- M3: `connection.update` com `loggedOut` repassado a `onConnectionChange` (ver SPEC 17).
- B5 (documentado): o 2o fator `apikey` no corpo so vale se o Evolution realmente o enviar (NAO verificado; ausente nao reprova).
- B11 (documentado): o token no caminho da URL aparece em logs de acesso de proxies/servidor; mascarar o path `/api/webhooks/whatsapp/*` no proxy reverso. Logs da aplicacao ja redigem o token.

### Verificacao E2E 2026-09-19 (Evolution v2.1.1 real + app dev)
- Evolution real entregou webhooks `connection.update` (state connecting/close, statusReason 405/200) no receiver via `host.docker.internal`; app respondeu 200 com o `apikey` da instancia no corpo aceito como 2o fator. Webhook configurado com `webhook/set` OK.
- Simulado com token da instancia: token malformado/inexistente -> 401 identico; GET -> 405; JSON invalido/sem envelope -> 400; `apikey` errada -> 401; evento de outra instancia -> 401; mensagem inbound -> `reply` (Touch inbound `replied`, lead `paused_replied`); mesmo `key.id` 2x -> `duplicate`; "PARAR" e "Nao quero" -> `opt_out` (lead `opted_out` + Suppression `opt_out_reply`); telefone desconhecido -> `lead_not_found`; grupo -> `ignored`; latencia 6-60 ms. Rate limit: tokens invalidos 429 com `Retry-After` apos ~120/min; token valido 429 apos ~300/min. PASS.
- Nao verificavel: `messages.upsert`/`messages.update` com formato REAL da v2.1.1 (exige WhatsApp pareado, ver SPEC-011).
