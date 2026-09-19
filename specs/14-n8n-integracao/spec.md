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
