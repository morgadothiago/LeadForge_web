# SPEC-015 — Busca de leads por IA (fase posterior)
- status: DRAFT | domain: backend | sessao: 2+ / fase posterior (nao entra nas 2 sessoes iniciais sem decisao) | ordem: 16 | depende de: SPEC-005, SPEC-008, SPEC-014
## Contexto
Requisito central do fluxo (passo 2) sem nenhuma especificacao no PROMPT: fontes, provedor de IA, custos, legalidade. [NEEDS_DECISION]
- D21 Fontes: Google Places API (paga, oficial) | scraping de sites publicos | LinkedIn (ToS proibe scraping; usar so API oficial/Sales Navigator/provedor terceiro tipo Apollo/PhantomBuster) | importacao CSV apenas no MVP.
- D22 Provedor IA/LLM (Claude API? outro) para qualificar/pontuar leads e extrair contatos, e para gerar personalizacao.
- D23 Frequencia ("todo dia") e limite diario/orcamento por campanha.
- Riscos: LGPD (base legal, opt-out), ToS das plataformas, bloqueio anti-bot, qualidade de contato.
## Escopo (apos decisao)
Interface `LeadSource` (search(icp) -> RawLead[]), 1 adaptador aprovado, normalizacao + dedupe + score (0-100) preenchendo Lead.score/source/rawData, job diario por campanha ativa (via SPEC-013/014), log de execucao (`SearchRun`), limite de custo.
## Criterios de aceite
- [ ] Adaptador testado com respostas mockadas; dedupe contra leads existentes.
- [ ] Respeita limite diario/orcamento.
- [ ] Leads entram como `novo_lead` na campanha do ICP com sequenceStatus not_started.
- [ ] Chave da API em env, nunca no cliente.

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (clients de busca/LLM): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.
