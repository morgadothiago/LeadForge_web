# SPEC-004 — Dashboard
- status: IMPLEMENTED | domain: fullstack (## Backend depois ## Frontend) | sessao: 1 | ordem: 5 | depende de: SPEC-001, SPEC-003
## Escopo
Backend: `src/lib/queries/dashboard.ts` — contagens (leads novos, em follow-up, respostas, reunioes) do periodo com variacao % vs periodo anterior; serie semanal (7 dias) por dia; ultimas 10 atividades (Touch inbound/outbound, mudancas de stage). Filtro opcional por campanha. Zod nos searchParams.
Frontend: 4 MetricCards (tendencia seta+%, verde/vermelho), grafico recharts semanal (client component isolado), lista de atividades, skeletons, estado vazio.
## Criterios de aceite
- [x] Com seed, valores conferem com contagens SQL diretas (teste de query).
- [x] Divisao por zero na tendencia tratada (exibe "—").
- [x] Sem N+1 (uma query por bloco, `include`/groupBy).
- [x] Filtro por campanha altera todos os blocos.
- [x] Estado vazio e skeleton visiveis; 375px sem overflow horizontal.
- [x] build/lint/typecheck OK.
## Decisoes pendentes
D8: definicao de "resposta" = Touch inbound? (INFERRED: sim).

## Backend (IMPLEMENTADO 2026-09-19; status da SPEC segue APPROVED ate o frontend)
Arquivos: `src/lib/queries/dashboard.ts`, `src/lib/queries/dashboard.test.ts`. typecheck/lint/test VERIFIED (23 testes).
Criterios backend: seed vs contagens diretas PASS; divisao por zero (`percent: null` -> UI "—") PASS; sem N+1 (counts/findMany com include, 1 query por bloco) PASS; filtro campanha em todos os blocos PASS. Criterios de UI: PENDENTE (frontend).

### Contrato para o frontend (Server Component chama direto, sem API route)
```ts
parseDashboardParams(raw: Record<string, string|string[]|undefined>): DashboardParams // nunca lanca; invalido -> default
getDashboardData(params: DashboardParams, now?: Date): Promise<DashboardData>
type DashboardParams = { period: "7d"|"30d"; campaignId?: string /*uuid*/ }
type DashboardData = { metrics: DashboardMetrics; weekly: WeeklyPoint[] /*7 itens*/; activities: DashboardActivity[] /*<=10*/; isEmpty: boolean }
type DashboardMetrics = { newLeads: Metric; followUp: Metric; replies: Metric; meetings: Metric }
type Metric = { value: number; previous: number; trend: { percent: number|null /*null => "—"*/; direction: "up"|"down"|"flat" } }
type WeeklyPoint = { date: string /*yyyy-MM-dd*/; newLeads: number; replies: number; sent: number }
type DashboardActivity = { id: string; kind: "touch_outbound"|"touch_inbound"|"stage_change"; at: Date; leadId: string; leadName: string; channel: Channel|null; stage: Stage|null }
```
Puras exportadas: `computeTrend`, `buildMetric`, `getPeriodRanges`, `buildWeeklySeries`, `mergeActivities`. Seed nao tem Touches/Meetings: metricas de respostas/reunioes = 0 e trend "—" (estado vazio parcial).

### Desvios / decisoes (sem mudar schema)
- D8 aplicada como INFERRED: resposta = Touch inbound.
- Sem historico de stage: "em follow-up" = Opportunity em `em_followup` com `updatedAt` no periodo; "mudanca de stage" = Opportunity com `updatedAt > createdAt` (stage atual). Historico real exigiria tabela nova (nao criada).
- Periodo (`period=7d|30d`) adicionado como param Zod alem de `campaignId`; fuso = do servidor.

## Implementation Notes (Frontend, 2026-09-19)
- Arquivos: `src/app/(app)/page.tsx` (async searchParams, Suspense com key por filtro), `src/components/dashboard/{DashboardContent,DashboardFilters,DashboardSkeleton,RecentActivities,WeeklyChart}.tsx`; `MetricCard` aceita `trend: number | null` ("—").
- Verificacao: typecheck, lint, test (23), build VERIFIED; dev server `/`, `/?period=30d`, `/?campaignId=xyz` = 200.
- Criterios UI: skeleton/vazio implementados; 375px por CSS (grid 1 coluna, flex-wrap, sem larguras fixas) — NOT VERIFIED em navegador.
- Grafico: recharts isolado (client), cores via CSS vars, resumo em figcaption + tabela sr-only. Filtros sao links (Server Component), sem JS.
- Limitacao: com seed, respostas/reunioes = 0 e trend "—".

## Adendo (autorizado pelo usuario) - StageHistory
- "Em follow-up" agora conta transicoes `toStage = em_followup` em `StageHistory.changedAt` no periodo (antes: aproximacao por `Opportunity.updatedAt`).
- Atividade `stage_change` vem de `StageHistory` com `fromStage` nao nulo (entrada inicial nao conta); id da atividade `stage:<historyId>`, `stage` = toStage.
- Contrato publico (getDashboardData, parseDashboardParams, tipos) inalterado. Testes conferem contagens contra o seed.
