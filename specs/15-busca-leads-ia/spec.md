# SPEC-015 — Busca de leads por IA (fase posterior)
- status: IMPLEMENTED (backend; e2e PENDENTE) | domain: backend | sessao: 2+ / fase posterior (nao entra nas 2 sessoes iniciais sem decisao) | ordem: 16 | depende de: SPEC-005, SPEC-008, SPEC-014
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

## Padrao pre-configurado (usuario: "deixar tudo pre-configurado para arrumar depois", 2026-09-19)
Defaults CONSERVADORES e reversiveis (D21-23): fonte = interface `LeadSource` com UMA implementacao inicial baseada em API OFICIAL (Google Places) com chave cadastrada no painel (SPEC-018); SEM scraping do LinkedIn nem de sites (viola termos e amplia risco LGPD); LLM opcional so para qualificar/pontuar (SPEC-019/`LlmProvider`); frequencia manual + agendada configuravel; teto de custo e de resultados por execucao; DESLIGADA ate existir chave e orcamento; resultados entram como leads com origem/fonte registradas, deduplicados, e passam pela supressao global antes de qualquer contato; so telefones/e-mails de cadastro publico de empresas; registrar base legal (interesse legitimo B2B) e fonte. Revisavel depois. Ver docs/CONFIGURACAO_POS_PROJETO.md.

## Implementation Notes
- Arquivos: src/lib/lead-search/{types,places,score,config,run}.ts + places.test.ts, run.test.ts; migration 20260919250000_search_run e model SearchRun (sem relacao com Campaign); `processItem` exportado em lead-ingest/handler.ts (reuso da 014: dedupe, supressao global, createLeadCore novo_lead/not_started); .env.example.
- Fonte: Google Places API (New) Text Search via axios proprio (429/Retry-After, 5xx, timeout, sem vazar chave), chave `places` do resolvedor SPEC-018. Score deterministico 0-100 (sem LLM; LLM opcional nao implementado). rawData registra fonte, base legal interesse_legitimo_b2b, externalId. Places nao devolve e-mail: so telefone/site.
- Limites: DESLIGADA (LEAD_SEARCH_ENABLED=true), max resultados/execucao (default 20, teto 60), orcamento diario de chamadas por campanha (default 3). `runLeadSearch(campaignId)` e `runDailySearch()` (job diario).
- Testes: 14 unit (vitest sem banco) VERIFIED; tsc e eslint VERIFIED. Criterios: adaptador mockado+dedupe PASS (unit, mock de prisma); limite PASS; novo_lead/not_started via createLeadCore PENDENTE e2e (Docker); chave so no servidor PASS (env/painel, header server-side).
- Pendente: migration nao aplicada; job diario NAO ligado ao tick/cron (run-tick.ts em edicao por outro agente); sem Server Action/UI para disparo manual e historico de SearchRun (dev-frontend + action); LLM de qualificacao.

## Implementation Notes (Frontend)
- Arquivos: src/lib/actions/lead-search.ts (`searchLeads`: requireUser+requireAdmin, valida id, rate limit 5/10min por usuario, chama runLeadSearch, revalidatePath), src/lib/queries/lead-search.ts (`getLeadSearchPanel`: nao-admin recebe so `canManage:false`; flags enabled/chave via integrationOrigin sem revelar valor; ultimos 10 SearchRun e uso diario), src/components/campaigns/CampaignLeadSearch.tsx, pagina da campanha (`campanhas/[id]/page.tsx`).
- UI: botao com confirmacao e loading, resultado (encontrados/novos/duplicados/suprimidos), historico com erro/motivo, aviso com link para /configuracoes/integracoes, bloqueio por limite diario/campanha inativa, estado sem permissao para nao-admin. Mobile-first (empilha em telas pequenas).
- Limitacao: limite diario/erros do historico dependem de `SearchRun.error`; acao de limite atingido nao cria SearchRun (backend lanca antes). Validacao em navegador NOT VERIFIED.

## Correcoes de QA
- Corrida: reserva atomica em `reserve()` (run.ts): transacao com `pg_advisory_xact_lock(hashtext('leadsearch:'||campanha))` em torno de check+create do SearchRun, usada tanto por manual quanto pelo agendado (guarda "1 agendada/dia" dentro do mesmo lock). Orcamento lido em UMA query (running conta >=1) para nao perder run entre snapshots. Teste com banco real: `run.concurrency.test.ts` (6 manuais simultaneos com orcamento 1 => 1 paga; 3 agendados => 1).
- Dia local: `startOfLocalDay('America/Sao_Paulo')` no run e em `queries/lead-search.ts`.
- Tick: `LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK` (default 3) e `LEAD_SEARCH_TICK_DEADLINE_MS` (default 30000); sobras ficam para o proximo tick. Documentado em `.env.example`. Agendado sem chave/desligado pula em silencio.
- Robustez: erro por item conta como `invalid` e o lote segue; falha no update de score/rawData e logada (lead mantido); contadores gravados tambem em run `failed`.
- Bloqueio visivel: trigger manual bloqueado (desligada, sem chave, limite diario) grava SearchRun `blocked` com motivo, requests 0 (nao conta orcamento); agendado nao grava. UI: rotulo "Bloqueada".
- Dedupe: `rawData.externalId` consultado por campanha antes do processItem. `itemSchema` (014, inalterado) ja rejeita lead sem e-mail/telefone (`invalid`) e restringe website/linkedin a http(s); logo dedupe so por externalId sem contato e inaplicavel.
- Verificacao: tsc (fora de src/scripts/_*) limpo, eslint limpo, `npm test` 888/888 VERIFIED.
