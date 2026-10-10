# SPEC-058 — "Buscar agora": busca de leads sob demanda na pagina da campanha (endurecimento e UX)
- status: IMPLEMENTED (058a e 058b; QA aprovado 2026-10-10; validacao em navegador e E2E real com chave Google PENDENTES) | domain: fullstack (058a backend / 058b frontend; preferir duas SPECs filhas) | sessao: 10 (UX) | depende de: SPEC-015, SPEC-030, SPEC-033, SPEC-018
- criada: 2026-10-10 | aprovada em 2026-10-10 com as recomendacoes (ver D-058-x finais)

## Objetivo
Dar ao dono da org um botao "Buscar agora" em `/campanhas/[id]` que dispara a busca Google Places da campanha sob demanda, com estados claros, protecao de custo e de concorrencia, e historico visivel. Reutiliza o core de `run.ts` sem duplicar logica.

## Contexto lido no repo (achado principal: JA EXISTE um botao manual; esta SPEC o endurece, nao o cria do zero)
- Botao/UI existente: `src/components/campaigns/CampaignLeadSearch.tsx:18-133` ("Buscar leads", ConfirmDialog, estados de config/ativa/orcamento em :36-42, historico de 10 runs em :93-114, resultado "N novos/duplicados/suprimidos" em :86-91). Montado em `src/app/(app)/campanhas/[id]/page.tsx:49`; painel de dados em `src/lib/queries/lead-search.ts:26-49`.
- Server action existente: `src/lib/actions/lead-search.ts:23-36` `searchLeads`: `requireActiveProviderOrg()` (:25), checa campanha via `scopedPrisma(orgId)` (:28), rate limit `SlidingLimiter(5, 10min)` por usuario EM MEMORIA (:20,29), chama `runLeadSearch(id,{trigger:"manual"})` SINCRONO (:31).
- Core: `src/lib/lead-search/run.ts`: `execute` (:65-133) exige campanha `active` (:69), respeita `isSearchEnabled` (:73) e chave `places` (:75), `reserve` (:34-59) com `pg_advisory_xact_lock` por campanha, 1 run `scheduled` por campanha/dia (:40-44), orcamento = soma de `requests` do dia da campanha, run `running` conta >=1 (:46-48); manual sem orcamento/config grava run `blocked` (:50-53); dedupe por `externalId` (:96-99) + telefone/e-mail e supressao via `processItem` (:100-104); legalBasis `interesse_legitimo_b2b` (:12,113). `runDailySearch` (:143-164) so chama `execute` com `scheduled`.
- Config: `src/lib/lead-search/config.ts:8-16` (`LEAD_SEARCH_ENABLED`, `MAX_RESULTS` default 20 teto 60, `DAILY_MAX_REQUESTS` default 3 teto 50 POR CAMPANHA).
- Places: `src/lib/lead-search/places.ts:30-55`: UMA chamada `searchText` por run, `pageSize<=20`, sem `nextPageToken` (`requests: 1` fixo :53).
- Tenant: `scopedPrisma` inclui `searchRun` via `campaign` (`src/lib/tenant/scoped-prisma.ts:71`). `OrgRole` so tem `owner|member` (`prisma/schema.prisma:124-127`); NAO existe papel "admin" na org. `requireProviderOrg`/`requireActiveProviderOrg` (`src/lib/auth/require-admin.ts:24,49`) NAO distinguem owner de member.
- Docs: `docs/GUIA.md:251-253` (secao 3.7). SPEC-015: `specs/15-busca-leads-ia/spec.md`.
- `maxDuration` so definido em route handlers de ingestao (`src/app/api/integrations/leads/route.ts:9`); a action atual nao define.

## Lacunas encontradas (o que esta SPEC resolve)
1. Papel: qualquer membro da org dispara busca paga (UI diz "somente administradores", mas o codigo checa so "provider ativo").
2. Concorrencia: `reserve` serializa por lock mas NAO impede 2 runs `running` simultaneos (manual x manual, manual x diaria) enquanto houver orcamento; run `running` preso (crash) conta 1 chamada para sempre no dia.
3. Orcamento: diaria e manual disputam o mesmo teto por campanha (3/dia): a diaria pode zerar o manual e vice-versa; sem teto por org.
4. Rate limit em memoria (`SlidingLimiter`) nao vale em multi-instancia/serverless.
5. Execucao sincrona na server action: sem `maxDuration`/timeout explicito; retry axios (3 tentativas, 20 s) pode estourar o limite da plataforma.
6. `usedToday` no painel soma so `requests` (run `running` conta 0), divergente do `reserve`.
7. Sem "estimativa restante" nem estado "rodando" persistente (recarregar a pagina perde o estado).
8. Valor da repeticao: sem paginacao, rodar de novo devolve quase os mesmos 20 resultados (so duplicados). Ver Q-058-6.

## Escopo
**058a backend**
- Guarda de papel (D-058-1): so `owner` da org dispara; novo helper `requireOrgOwner()` reutilizavel (le `Membership.orgRole` da org da sessao; org `active`). Membro comum ve botao desabilitado com explicacao.
- Escopo por org: toda leitura/escrita via `scopedPrisma(orgId)`; `campaignId` validado pertencente a org antes de qualquer chamada paga (como hoje :28). Nunca aceitar `orgId` do cliente.
- Reuso do core: `searchLeads` continua chamando `runLeadSearch`/`execute`; qualquer regra nova (lock "ja em execucao", teto manual, stale) entra em `reserve` de `run.ts`, valendo igual para diaria e manual. Proibido copiar logica de dedupe/supressao/maxResults.
- Concorrencia (D-058-3): dentro do advisory lock de `reserve`, recusar se ja existe run `running` da campanha com `startedAt` > agora - STALE (padrao 10 min); runs `running` mais antigas que STALE sao marcadas `failed` ("Execucao interrompida") e liberam orcamento (cobrando 1). Diaria que encontra manual `running` pula sem consumir (`skipped`); manual que encontra diaria `running` recebe erro PT-BR "Ja existe uma busca em andamento". Idempotencia: duplo clique/retry do mesmo cliente devolve o run em andamento (campo `runId`), nunca cria segundo.
- Orcamento (D-058-2): reserva do manual separada: `LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS` (padrao 2, teto 20) por campanha/dia, contado so sobre runs `trigger=manual`; a diaria mantem `DAILY_MAX_REQUESTS` so sobre `scheduled`. Teto total por org/dia opcional `LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS` (padrao 10) somando as duas origens (protege conta Places do usuario). Run `blocked` nao consome.
- Rate limit: manter o limiter em memoria como 1a barreira (UX) mas a barreira real passa a ser o orcamento persistido no banco + lock; documentar a limitacao (padrao `org/rate-limit.ts`). Erro tipado em `ActionResult` (nao status HTTP).
- Execucao (D-058-4): ver Q-058-1. Recomendado: fila no tick. Action so valida, reserva (`SearchRun` status `queued`, trigger `manual`) e retorna `runId`; o tick processa `queued` antes da diaria (limite `maxCampaignsPerTick`/deadline ja existentes) reusando `execute`. Novo status `queued` no enum/String de `SearchRun` (verificar se e String ou enum no schema; migracao aditiva).
- Query `getLeadSearchPanel` passa a devolver: `remainingManual`, `remainingOrg`, `estimatedPaidCallsLeft`, `activeRun` (queued/running), `role` do usuario; `usedToday` calculado com a MESMA regra de `reserve` (running >=1) — extrair funcao unica de contagem.
- Endpoint/action de status por polling: `getSearchRunStatus(runId)` com `scopedPrisma` (so runs de campanhas da org).
**058b frontend**
- Botao "Buscar agora" (renomear o atual) no cabecalho do card; ConfirmDialog mostra custo ("usa 1 chamada paga; restam N hoje").
- Estados (cada um com texto PT-BR e acessibilidade `role=status`): desligada no servidor (explicacao + sem link, e acao ao operador: texto "peca ao administrador da plataforma"; flag e env); sem chave (link `/configuracoes/integracoes`); sem permissao (membro); campanha nao ativa; orcamento esgotado (diz qual: manual/org/diario); em fila/rodando (spinner, polling a cada 3 s, max 2 min de UI, depois "continua em segundo plano"); concluida: "N novos, M duplicados, K suprimidos (J invalidos)"; falha com mensagem do run.
- Estado "rodando" sobrevive a refresh (vem de `activeRun`).
- Historico: lista atual de 10 `SearchRun` com trigger (Agendada/Manual), status (incluir Na fila), contadores e erro; link "ver mais" opcional (Q-058-8).
- Estimativa de custo: "Restam X buscas manuais hoje (Y chamadas pagas na conta). Cada busca = 1 chamada Places Text Search; preco por chamada depende do seu plano Google (nao exibimos valor em R$)."

## Fora do escopo
Paginacao/`nextPageToken`, multiplas queries ou raio por busca (ver Q-058-6); trocar de fonte; alterar prompt/ICP; envio automatico de mensagens (leads continuam `not_started`); mudar o horario/frequencia da busca diaria; Redis/rate limit distribuido; papel "admin" de org (so owner/member existem); cobranca/medicao em R$.

## Requisitos nao funcionais e regras
- Respeita: `LEAD_SEARCH_ENABLED`, chave `places` (por org, `findIntegrationConfig`), `maxResultsPerRun`, dedupe (externalId/telefone/e-mail), supressao/opt-out via `processItem`, `HARD_MAX_RESULTS`.
- Nunca logar PII nem chave (`safeErrorForLog`); erro da Places normalizado pelo axios existente (429 com `Retry-After`, 5xx, timeout) — regra transversal do `specs/README.md`.
- Migracao (se `queued`/campo novo): aditiva, sem apagar dados.

## Criterios de aceitacao
- [ ] Membro nao-owner: action recusa com erro tipado PT-BR e NENHUMA chamada a Places/`SearchRun` criada; owner passa.
- [ ] Campanha de outra org: "Campanha nao encontrada", sem chamada paga (teste cross-tenant).
- [ ] `LEAD_SEARCH_ENABLED` desligado, sem chave, campanha inativa: bloqueio com mensagem correta e run `blocked` so no manual; botao desabilitado com explicacao/link corretos.
- [ ] Orcamento manual/org esgotado: bloqueia sem chamar Places; run `blocked` nao consome; diaria nao e afetada pelo teto manual.
- [ ] Concorrencia: 2 disparos simultaneos (Promise.all) geram 1 run e 1 chamada Places; manual durante diaria `running` e recusado; diaria durante manual `running` pula; run `running` > STALE vira `failed` e libera orcamento (teste com banco real, estilo `run.concurrency.test.ts`).
- [ ] Reuso: diff nao duplica dedupe/supressao/score; testes existentes de `run.test.ts` seguem verdes.
- [ ] Resultado exibe "N novos, M duplicados, K suprimidos"; historico mostra run manual com os mesmos numeros; contador do painel == regra do `reserve`.
- [ ] Estado rodando persiste ao recarregar; polling termina em done/failed; falha de Places (429/5xx/timeout mockados) vira run `failed` com mensagem PT-BR e sem vazar chave.
- [ ] Estimativa de chamadas restantes visivel e correta apos cada run.
- [ ] Lint, typecheck e suite de testes verdes; validacao visual em navegador (desktop/mobile) pelo dev-frontend.
- [ ] (OPCIONAL, manual, separado) E2E real: com chave Places do usuario e `LEAD_SEARCH_ENABLED=true`, clicar "Buscar agora" numa campanha ativa com ICP real e conferir leads criados (rawData.legalBasis, score), 2o clique so duplicados, historico e estimativa; NAO bloqueia IMPLEMENTED (marcar PENDENTE ate o usuario executar; envolve custo real e depende de Docker/Postgres).

## Seguranca e riscos
- Custo: acao paga disparavel por usuario -> papel owner, tetos persistidos no banco, confirmacao com custo, run `blocked` auditavel.
- Isolamento: `orgId` so da sessao; `scopedPrisma`; polling so le runs da propria org.
- Chave Places nunca no cliente nem em log; painel so mostra `hasKey`.
- Rate limit em memoria nao vale entre instancias: mitigado pelo orcamento persistido.
- Fila: runs `queued` orfas (tick parado) -> expirar apos STALE e avisar; tick Vercel Hobby nao roda por minuto (GUIA 4.1; hoje `vercel.json` tem cron do tick) -> latencia do manual depende do cron (por isso Q-058-1).
- LGPD: nenhuma coleta nova; mesmos campos do RawLead (nome, telefone/site de cadastro publico da empresa); base legal `interesse_legitimo_b2b` gravada em `rawData`; supressao/opt-out aplicados antes de criar lead; sem e-mail coletado.

## Decisoes
- D-058-1 (INFERRED): so `owner` dispara (modelo atual tem so owner/member). Alternativa: todo membro. Aguarda confirmacao (Q-058-2).
- D-058-2 (INFERRED): teto manual proprio + teto por org, separado da diaria (Q-058-3).
- D-058-3 (INFERRED): lock "uma busca por campanha por vez" + expiracao de run preso (10 min).
- D-058-4 (NEEDS_DECISION): sincrona vs fila (Q-058-1).

## Perguntas abertas (Q-) com recomendacao
- Q-058-1 Sincrona ou fila+polling? Hoje 1 chamada Places (timeout 20 s, ate 3 tentativas) + ate 20 itens sequenciais em `processItem` + updates: tipicamente 2-8 s, pior caso >60 s. Recomendo: FILA no tick + polling quando o cron roda a cada minuto (latencia ate ~60 s, ruim para um botao); alternativa recomendada se a latencia incomodar: sincrona com `export const maxDuration = 60`, timeout total de 45 s na action (AbortSignal) e run `failed` ao estourar. Minha recomendacao final: hibrido simples = sincrona com maxDuration 60 + estado `running` persistido + polling de recuperacao se o usuario recarregar; migrar para fila so se ultrapassar 30 s na pratica. Decidir.
- Q-058-2 Quem pode disparar? Recomendo so `owner` (custo). Membro comum so le historico.
- Q-058-3 Teto manual: recomendo 2 manuais/dia/campanha + 10 chamadas/dia/org, separados da diaria (padrao 3). Ou compartilhar o mesmo teto atual (mais simples, mas a diaria pode consumir tudo)?
- Q-058-4 Existe flag por org (kill switch) alem do `LEAD_SEARCH_ENABLED` global? Recomendo NAO nesta SPEC.
- Q-058-5 Mensagem de "desligada": o dono da org nao controla env; recomendo texto "indisponivel no momento, fale com o suporte" em vez de citar `LEAD_SEARCH_ENABLED` ao usuario final (hoje a UI cita a env, :37).
- Q-058-6 Repetir a busca devolve os mesmos ~20 resultados (sem paginacao). Aprovar SPEC futura de paginacao (`nextPageToken`, ate 60) ou rotacao de query (keywords) para tornar "Buscar agora" util? Recomendo SPEC separada; aqui so avisar "resultados repetidos tendem a duplicados".
- Q-058-7 `queued`: enum ou String no schema? verificar e propor migracao (so se Q-058-1 = fila).
- Q-058-8 Historico: manter 10 itens ou paginar? Recomendo manter 10 + "ver mais" depois.
- Q-058-9 Dividir em 058a (backend) e 058b (frontend) como SPECs separadas? Recomendo SIM (padrao do repo: 049/051/052).

## Restricoes de implementacao
Next 16: ler `node_modules/next/dist/docs/` antes de codar (AGENTS.md). Axios para HTTP externo. Nada de commit sem pedido. Atualizar `docs/GUIA.md` secao 3.7 ao final.

## Decisoes finais (CONFIRMED, 2026-10-10, aprovadas com as recomendacoes)
- D-058-1 CONFIRMED: so `owner` dispara; member apenas le historico (Q-058-2).
- D-058-2 CONFIRMED: teto manual 2/dia por campanha e 10 chamadas/dia por org, separado do teto da diaria (Q-058-3).
- D-058-3 CONFIRMED: lock "uma busca por campanha por vez" + expiracao de run preso (10 min).
- D-058-4 CONFIRMED: execucao sincrona com `maxDuration=60`, timeout 45 s, estado `running` persistido e polling de recuperacao; fila so se passar de 30 s na pratica (Q-058-1). Sem status `queued` agora (Q-058-7: so se fila).
- D-058-5 CONFIRMED: sem kill switch por org (Q-058-4).
- D-058-6 CONFIRMED: texto de "desligada" = "indisponivel no momento, fale com o suporte"; nao citar env var ao usuario (Q-058-5).
- D-058-7 CONFIRMED: paginacao em SPEC separada; UI so avisa que repetir tende a duplicados (Q-058-6).
- D-058-8 CONFIRMED: historico de 10 itens (Q-058-8).
- D-058-9 CONFIRMED: dividida em 058a (backend, APPROVED) e 058b (frontend, APPROVED; so inicia apos 058a QA-aprovada) (Q-058-9).
