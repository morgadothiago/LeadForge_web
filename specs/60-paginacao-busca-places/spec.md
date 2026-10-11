# SPEC-060 — Paginacao da busca de leads Places (nextPageToken + rotacao de variacoes)
- status: IMPLEMENTED (2026-10-11; aprovada por delegacao do usuario ao orquestrador; E2E real com chave Google PENDENTE) | domain: fullstack (backend + ajuste minimo de UI) | sessao: 11 | depende de: SPEC-015, SPEC-058
- criada: 2026-10-11 | origem: RETOMAR item 12 / Q-058-6 / D-058-7 (paginacao em SPEC separada)

## Objetivo
Hoje cada busca e 1 pagina de ate 20 resultados e repetir a busca devolve os mesmos resultados (so duplicados). Cada busca (manual ou diaria) passa a CONTINUAR de onde a anterior parou: usa `nextPageToken` do Text Search (Places API New) e, esgotadas as paginas, rotaciona variacoes da query. O cursor e persistido por campanha.

## Contexto (codigo atual)
- `src/lib/lead-search/places.ts`: 1 chamada `places:searchText`, `pageSize<=20`, FieldMask sem `nextPageToken`, `requests: 1`.
- `src/lib/lead-search/run.ts`: `reserve` (orcamento da SPEC-058 via `budget.ts`), `execute` chama `source.search`, dedupe por `externalId` (campanha) + `processItem` (telefone/e-mail/supressao).
- `SearchRun` (prisma): sem campo de cursor. UI: `CampaignLeadSearch.tsx`, painel `queries/lead-search.ts`.

## Escopo
1. Contrato `LeadSource.search(icp, limit, signal?, opts?)` com `opts.cursor` (`{variant, pageToken|null, query}`) e `opts.maxRequests`; retorna tambem `cursor` (proximo).
2. `PlacesSource`: FieldMask inclui `nextPageToken`; com cursor valido envia `pageToken` + mesmo `textQuery`; sem token (paginas esgotadas) avanca para a proxima variacao da query; query do cursor diferente da atual (ICP mudou) reinicia na variacao 0.
3. Variacoes (deterministicas): base (`niche + 2 keywords + location`), depois `niche + keyword + location` por keyword, depois sufixos genericos ("empresas", "servicos", "melhores"); sem duplicatas; ciclo por modulo.
4. Token invalido/expirado (HTTP 400 -> `validation`): se o orcamento permitir uma 2a chamada nesta mesma busca, refaz na proxima variacao sem token; senao encerra a busca com 0 resultados e deixa o cursor para avancar de variacao na proxima. Nunca ultrapassa o teto.
5. Orcamento (SPEC-058): cada pagina/chamada e requisicao cobravel. `reserve` calcula as chamadas restantes (manual: min(manual, org); diaria: teto diario - usado) e entrega `maxRequests = min(restante, 2)` a fonte. `requests` do run = chamadas realmente feitas.
6. Persistencia: colunas aditivas em `SearchRun`: `pageToken String?`, `searchQuery String?`, `variant Int @default(0)`; gravadas so em run `done`. Cursor vigente = ultimo run `done` da campanha com `searchQuery` nao nulo. Migration escrita a mao, aditiva.
7. UI minima: painel expoe `hasNextPage`; botao/dialogo dizem "Buscar mais resultados" quando houver proxima pagina; o aviso de duplicados e ajustado.
8. Dedupe inalterado (externalId por campanha + processItem); uma pagina por busca (sem laco multi-pagina no mesmo clique).

## Fora do escopo
Varias paginas por clique; dedupe cross-campanha por placeId; mudar tetos da SPEC-058; Redis; alterar ICP/prompt; mudar horario da diaria.

## Criterios de aceitacao
- [x] AC-1: 1a busca sem cursor chama Places sem `pageToken` e devolve `cursor` com o `nextPageToken`.
- [x] AC-2: busca seguinte envia `pageToken` + mesmo `textQuery` e traz resultados novos (sem duplicar os ja criados).
- [x] AC-3: sem `nextPageToken` na resposta, a proxima busca usa a proxima variacao da query (fallback).
- [x] AC-4: token invalido (400) com orcamento para 2 chamadas refaz na proxima variacao (requests=2); com `maxRequests=1` NAO faz 2a chamada, retorna 0 leads e cursor que avanca de variacao.
- [x] AC-5: orcamento esgotado nao chama Places e nao altera cursor; `requests` do run <= restante.
- [x] AC-6: cursor persistido em run `done` e lido pela busca seguinte (banco real); run `failed` nao altera o cursor.
- [x] AC-7: ICP alterada invalida o cursor (reinicia na variacao 0).
- [x] AC-8: nenhum erro/log/cursor contem a chave de API.
- [x] AC-9: UI mostra "Buscar mais resultados" quando `hasNextPage`.
- [x] AC-10: tsc, eslint (0 erros), vitest completo verdes; testes da 015/058 seguem verdes.

## Decisoes
- D-060-1 (INFERRED): cursor em `SearchRun` (3 colunas aditivas) em vez de tabela/coluna em `Campaign`; reaproveita o historico e a ordem temporal.
- D-060-2 (INFERRED): uma pagina por busca; custo previsivel = 1 a 2 chamadas pagas (2 no fallback de token invalido; a contagem real vem de `SearchOptions.progress`, visivel ao run mesmo se a 2a falhar).
- D-060-3 (INFERRED): token invalido = HTTP 400; tokens nao tem expiracao documentada estavel, entao nao ha TTL local: confiar no 400 + fallback.
- D-060-4 (INFERRED): variacoes deterministicas por indice (`variant`), ciclo por modulo; ao dar a volta completa podem reaparecer duplicados (limitacao).
- D-060-5 (INFERRED): `maxRequests` entregue pela reserva garante que o fallback nunca estoura o teto.

## Implementation Notes
- Arquivos: `src/lib/lead-search/{types,places,run}.ts`, `src/lib/queries/lead-search.ts`, `src/components/campaigns/{CampaignLeadSearch.tsx,lead-search-format.ts}`, `prisma/schema.prisma`, migration `prisma/migrations/20261016120000_search_run_cursor_060/migration.sql` (escrita a mao, aditiva, NAO aplicada no banco dev `leadforge`; aplicada so no `leadforge_060b_test` pelo global-setup).
- Testes: `places.test.ts` (bloco "SPEC-060 paginacao"), `run.060.cursor.test.ts` (banco real), `CampaignLeadSearch.test.tsx`. Resultado: tsc limpo, eslint 0 erros, vitest completo 163 arquivos / 2053 testes VERIFIED (TEST_DATABASE_URL = banco `leadforge_060b_test`).
- AC: todos PASS (AC-1..8 em places.test/run.060; AC-9 em CampaignLeadSearch.test; AC-10 suite completa).
- Limitacoes: uma pagina por busca; ao ciclar todas as variacoes podem reaparecer duplicados; dedupe segue por campanha (nao cross-campanha); sem TTL local do token (confia no 400); validacao real com Google nao executada.
