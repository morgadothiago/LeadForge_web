# SPEC-014 — Integracao n8n
- status: DRAFT | domain: backend | sessao: 2 (fase posterior, opcional) | ordem: 15 | depende de: SPEC-013
## Contexto
PROMPT lista n8n (passo 14) sem dizer o que ele faz. [NEEDS_DECISION D20] Papel do n8n:
1. Apenas disparar o tick do scheduler (cron) — minimo.
2. Orquestrar busca de leads (SPEC-015) e postar leads em `POST /api/integrations/leads`.
3. Nao usar n8n (usar cron do host / scheduler interno).
## Escopo (se 1 e/ou 2)
Endpoint autenticado por segredo para ingestao de leads (Zod, dedupe, atribui campanha), workflow exportado em `n8n/workflows/*.json` versionado, doc de setup. n8n usa DB separado (SPEC-000 D2).
## Criterios de aceite
- [ ] Endpoint de ingestao: 401 sem segredo, 400 invalido, dedupe correto (testes).
- [ ] Workflow JSON importavel (validacao de schema JSON); execucao real PENDENTE (docker parado).

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (client n8n): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.

## Padrao pre-configurado (usuario: "deixar tudo pre-configurado para arrumar depois", 2026-09-19)
D20 = opcao 1 (n8n OPCIONAL, so dispara `/api/cron/tick` e, no futuro, posta leads). Entrega minima: workflow versionado em `n8n/workflows/tick.json` (Schedule 1 min -> HTTP Request POST com header `Authorization: Bearer <CRON_SECRET>` lido de credencial do n8n, nunca hardcoded), doc de setup, endpoint de ingestao de leads (`POST /api/integrations/leads`, segredo proprio, Zod, dedupe, 401/400) DESLIGADO por padrao. Sem n8n o sistema funciona com cron do host ou `npm run tick`. Ver docs/CONFIGURACAO_POS_PROJETO.md.

## Backend (implementado; status permanece APPROVED ate QA)
Contrato de `POST /api/integrations/leads` (somente POST; demais metodos 405 com `Allow: POST`):
- Env: `INTEGRATION_LEADS_ENABLED` (exatamente `true`) E `INGEST_SECRET` (32+ chars); senao 503 (desligado por padrao). `/api/integrations/*` isento da guarda de login em `src/proxy.ts`.
- Headers: `Authorization: Bearer <INGEST_SECRET>` (SHA-256 + timingSafeEqual; 401 identico sem/errado), `Content-Type: application/json`, `Idempotency-Key` opcional (1-128 de `[A-Za-z0-9._:-]`).
- Rate limit: tentativas invalidas 20/min (chave global unica) -> 429 + Retry-After; credencial valida 600/min -> 429 + Retry-After.
- Corpo (max 1 MB lido do stream; 413): `{ campaignId: uuid, leads: [{ name, company?, email?, phone?, website?, linkedin?, source?, tags?[], externalId? }] }`, 1 a 100 itens. Cada item exige e-mail OU celular BR valido (E.164); `source` livre exceto "seed" (item invalido); default `integration`; `externalId` guardado em `Lead.rawData`.
- Respostas: 200 `{ campaignId, total, created, duplicate, suppressed, invalid, results: [{ index, status: created|duplicate|suppressed|invalid, leadId?, reason? }] }` (repeticao de Idempotency-Key devolve o mesmo resultado + `idempotentReplay: true`); 400 payload/JSON/chave invalidos; 401; 404 campanha inexistente; 409 chave em processamento; 413; 422 chave reutilizada com outro corpo; 429; 500 generico; 503.
- Regras: dedupe por (campaignId,email) e (campaignId,phone) -> `duplicate`; contato em `Suppression` -> `suppressed` (nao cria); lead nasce `not_started` (Campaign.autoStart decide o inicio) com Opportunity `novo_lead` + StageHistory numa transacao Serializable (`createLeadCore` em `src/lib/domain/lead-create.ts`, compartilhado com `createLead`).
- Auditoria: `WebhookEvent` source `lead_ingest` com contadores e ids apenas (sem PII/segredo); logs so com contagens.
- Como agendar o tick: workflow `n8n/workflows/tick.json` (credencial Header Auth "LeadForge CRON_SECRET"), cron do host ou `npm run tick`; ver `docs/N8N.md`.
- PENDENTE: importacao/execucao dos workflows em n8n real (so validacao estatica em `src/lib/lead-ingest/n8n-workflows.test.ts`).
