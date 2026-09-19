# SPEC-012 — Webhook receiver (WhatsApp)
- status: DRAFT | domain: backend | sessao: 2 | ordem: 13 | depende de: SPEC-001, SPEC-011
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
