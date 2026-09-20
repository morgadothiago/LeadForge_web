# SPEC-014 — Integracao n8n
- status: IMPLEMENTED (QA achou NEEDS_FIX; correcoes verificadas por testes 801/801, sem segundo QA; importacao/execucao em n8n real, HTTP real e docker compose PENDENTES)
## Contexto
PROMPT lista n8n (passo 14) sem dizer o que ele faz. [NEEDS_DECISION D20] Papel do n8n:
1. Apenas disparar o tick do scheduler (cron) — minimo.
2. Orquestrar busca de leads (SPEC-015) e postar leads em `POST /api/integrations/leads`.
3. Nao usar n8n (usar cron do host / scheduler interno).
## Escopo (se 1 e/ou 2)
Endpoint autenticado por segredo para ingestao de leads (Zod, dedupe, atribui campanha), workflow exportado em `n8n/workflows/*.json` versionado, doc de setup. n8n usa DB separado (SPEC-000 D2).
## Criterios de aceite
- [ ] Endpoint de ingestao: 401 sem segredo, 400 invalido, dedupe correto (testes).
- [x] Workflow JSON importavel (validacao de schema JSON); importado e executado no n8n 1.82.1 real (verificado E2E 2026-09-19: `n8n import:workflow --separate` OK; ingest executado com credencial Header Auth -> HTTP 200 no endpoint). Ressalvas: `tick.json` (Schedule Trigger) nao e executavel via `n8n execute` (limite do CLI; so ativacao pela UI); credencial referenciada so por nome (sem id) -> execucao exige reselecionar a credencial no no.

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
- Respostas: 200 `{ campaignId, total, created, duplicate, suppressed, invalid, results: [{ index, status: created|duplicate|suppressed|invalid, leadId?, reason? }] }` (repeticao de Idempotency-Key devolve o mesmo resultado + `idempotentReplay: true`); 400 payload/JSON/chave invalidos; 401; 404 campanha inexistente; 409 chave em processamento (Retry-After 1; reserva > 2 min e reassumida via updateMany condicional) ou campanha arquivada ("Campanha arquivada: nao aceita novos leads."; pausada aceita); 413; 422 chave reutilizada com outro conteudo (hash SHA-256 do JSON canonico do corpo, guardado em WebhookEvent.payload; corpo nunca guardado); 200 pode trazer `warnings: ["auditoria_nao_gravada"]` se a auditoria falhar apos criar leads (chave liberada; reenvio => duplicate); 429; 500 generico; 503.
- Regras: dedupe por (campaignId,email) e (campaignId,phone) -> `duplicate`; contato em `Suppression` -> `suppressed` (nao cria); lead nasce `not_started` (Campaign.autoStart decide o inicio) com Opportunity `novo_lead` + StageHistory numa transacao Serializable (`createLeadCore` em `src/lib/domain/lead-create.ts`, compartilhado com `createLead`).
- Validacao: name/company/source/externalId rejeitam controles e U+2028/2029 (item invalid). E-mail `+tag` nao normalizado (decisao). Riscos autoStart/rate limit/concorrencia em docs/N8N.md.
- QA-014 (A) corrigido: F1,F2,F3,F5,F7; F3b/F4/F6 documentados.
- Auditoria: `WebhookEvent` source `lead_ingest` com contadores e ids apenas (sem PII/segredo); logs so com contagens.
- Como agendar o tick: workflow `n8n/workflows/tick.json` (credencial Header Auth "LeadForge CRON_SECRET"), cron do host ou `npm run tick`; ver `docs/N8N.md`.
- PENDENTE: importacao/execucao dos workflows em n8n real (so validacao estatica em `src/lib/lead-ingest/n8n-workflows.test.ts`).

### Verificacao E2E 2026-09-19 (n8n 1.82.1, app dev em :3000, INGEST_SECRET/CRON_SECRET temporarios via env)
- Endpoint real: 401 sem/errado, 405 GET, 400 JSON/envelope invalido, 404 campanha inexistente, 200 lote misto (2 created + 1 invalid), replay com mesma Idempotency-Key -> `idempotentReplay:true`, mesma chave com corpo diferente -> 422, mesmo corpo sem chave -> `duplicate` (dedupe por lead), e-mail com caixa diferente -> `duplicate`. PASS.
- n8n: container alcanca o app (`host.docker.internal:3000`); ingest exemplo executado no n8n com `Idempotency-Key` por execucao -> 200 (1a `created`, 2a `duplicate`).
- Import: `n8n import:workflow --input=arquivo.json` FALHA ("workflows.map is not a function") porque o CLI espera ARRAY; use `--separate --input=<dir>/` ou a UI (Import from File, aceita objeto). Vale registrar em docs/N8N.md.
- PENDENTE: 503 com endpoint desligado e execucao agendada do tick.json pelo n8n (Schedule Trigger) nao exercitados; execucao do 100-leads em lote e 429 real do endpoint nao exercitados.
