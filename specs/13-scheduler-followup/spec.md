# SPEC-013 — Scheduler de follow-up (dias 0,2,5,7,10)
- status: DRAFT | domain: backend | sessao: 2 | ordem: 14 | depende de: SPEC-006, SPEC-010, SPEC-011, SPEC-012
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
