# SPEC-044 — react-hook-form: Sequences, Templates, Agentes, Calendario
- status: IMPLEMENTED (dev-frontend, 2026-09-28; QA APPROVED) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao da SPEC-042 os formularios de: `SequenceBuilder.tsx`, `TemplateManager.tsx`, `AgentsPanel.tsx`, `DraftQueue.tsx`, `MeetingDialog.tsx`.

## Escopo
Mesmo padrao da SPEC-042. Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [x] Todos os 5 arquivos migrados ou no-op documentado (`DraftQueue`), mesmo comportamento de validacao client+server de antes.
- [x] Nenhuma regressao nos testes existentes.
- [x] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aprovado (`APROVAR SPEC-044`).

## Implementation Notes (dev-frontend, 2026-09-28)

### Arquivos alterados
- `src/components/sequences/SequenceBuilder.tsx` — migrado. `useForm<{name, steps: StepDraft[]}, unknown, SequenceSubmit>` + `zodResolver(z.preprocess(...))` com schema composto local `sequenceFormSchema = z.object({name: sequenceNameSchema, steps: sequenceStepsSchema.shape.steps}).superRefine(nonDecreasingDays)` (mesmas regras de `renameSequence`/`saveSequenceSteps`/`createSequence`). O `preprocess` stripa a chave de UI `key` e so mantem `id` quando presente. `steps` via `setValue` (`setSteps` vira wrapper), edicoes via `watch("steps")`. Submit create → `createSequence` (map sem id); edit → rename so se `values.name.trim() !== sequence.name`, depois `saveSequenceSteps`.
- `src/components/sequences/TemplateManager.tsx` — migrado (so o `TemplateForm`; lista/delete inalterados, nao sao captura). `FormValues {name, channel, subject, body}`; preprocess injeta `campaignId` (e `id` no edit) e `subject: v.channel === "email" ? v.subject : null` (espelha o `payload()` original — sem isso o refine "Assunto so e permitido para e-mail" dispararia ao trocar o canal). Canal `watch`+`setValue`; `insertVar` com refs compostas (ref do `register` + ref local) lendo `getValues()`; falha de `previewTemplate` → erros inline/banner SEM toast (paridade); falha de save → banner + `toast.error(getFormError(...))` (padrao 042, delta documentado).
- `src/components/agents/AgentsPanel.tsx` — migrado nos 4 formularios com captura:
  - `AgentForm`: `AgentFormValues` com chaves = chaves do schema (numeros como string: `dailyMessageLimit`, `maxTurnsPerLead`, `samplePercent`; budget como string em `monthlyBudgetCents`). Ternario create/edit no `useMemo`: create = `{...buildBody(v, null), role}` → `createAgentSchema`; edit = `{...buildBody(v, agent), id}` → `updateAgentSchema` (ausencia de `minConfidence`/`role` = inalterado, como antes). `buildBody` monta `allowedTools: AgentTool[]`, `parseLines`, `trim||null`, `callLink` so quando `role === "closer"` — mesmo shape do submit original.
  - **Budget (plan A)**: formato invalido vira `null` no preprocess e e barrado em `onValid` por pre-checagem com `getValues()` + `resolveBudgetInput` — as 3 mensagens originais sao preservadas literalmente ("Informe um valor em reais maior que zero.", erro do parser, "Desmarque..."). Campo registrado no nome `monthlyBudgetCents` (chave do schema) para que o live-clear do resolver limpe erros anteriores. Checkbox "Remover teto" = `watch`+`setValue` com `shouldValidate: true`.
  - Troca de `role` = `watch`+`setValue` em dois campos (`role` + `disclosure`, como o onChange original); disclosure on/off = `watch`+`setValue`.
  - `KnowledgeSection` = form proprio (`knowledgeSchema`, `agentId` injetado no preprocess) com botao `type="button"` + `onClick={handleSubmit(onValid)}` — `<form>` aninhado dentro do AgentForm seria HTML invalido. Gating `!title.trim() || !content.trim()` removido do botao (delta documentado: clique revela o erro do schema inline, regra igual do server).
  - `GlobalBudget`: form proprio, `budgetCentsOf` no preprocess; vazio+com teto atual → `confirmClear` (resolver passa com `null`), vazio+sem teto → erro "Informe um valor em reais maior que zero.".
  - `SimulateDialog`: form proprio (`simulateSchema`, `inboundText` so quando trim nao vazio); falha de simulacao → so `toast.error` (paridade).
- `src/components/calendar/MeetingDialog.tsx` — migrado (`MeetingForm`; `LeadPicker` mantido como componente de busca, nao e form de captura). `FormValues` de `src/lib/calendar/form.ts` + preprocess que constroi `startsAt` (`startsAtISO` com guard de regex E de `Number.isNaN` — nunca `toISOString()` de Invalid Date), `durationMin = endMin - startMin`, `link/notes` trim; create injeta `opportunityId`+`clientRequestId` (state), edit injeta `id`. `Data` exibe o erro da chave `startsAt`, `Fim` o de `durationMin` (chaves do schema, caminhos que o server tambem usa). Conflitos de preview continuam com o mesmo guard original (`endMin > startMin` + regex do dateKey). Transicoes (cancelar/realizada/no-show) → falha = banner via `setError("root")` SEM toast (paridade). `LeadPicker` seleciona via `setValue("opportunityId")`.

### No-op documentado (1 dos 5 arquivos do Objetivo)
`DraftQueue.tsx` **nao contem formulario de captura**: e um renderer de acoes sobre rascunhos aprovados (botoes `type="button"` que chamam actions), sem `<form>`, sem payload validado por schema e sem `useState` de valores — o gating visual (`canApprove`/`canReject`) espelha a mesma regra `min1` que a action ja valida. Migraria para `zodResolver` seria cerimonia (dupla validacao do mesmo gate). Mesmo criterio da SPEC-043 ("formularios que submetem valores a uma action com schema Zod"). `CloserAutoDialog` (checkbox `canConfirmAuto` guiado por `disclosureEnabled` derivado do server) e o select de autonomia no `AgentCard` (acao imediata, sem submit) tambem ficam inalterados.

### Mensagens/deltas de UX documentados (regra de validacao inalterada em `src/lib/schemas/*` e actions)
- **SequenceBuilder**: client check manual "Selecione um template." → mensagem do schema `"Template inválido."`; `"Dia é obrigatório."` mantida (`z.number({error})` zod4); nome agora validado client-side com a mesma mensagem do server (antes so falhava no submit); falha de validacao client perde o `toast.error("Corrija os campos destacados.")` e ganha auto-focus (padrao 042: inline + `shouldFocusError`, sem toast). Rename com falha continua SEM toast (so erros em campo, paridade); falha de create/save usa o toast fixo original "Não foi possível salvar a sequência.".
- **MeetingDialog**: "Informe a data." → `"Início inválida: use ISO 8601 com fuso (ex.: ...)"` (refine do `isoInstant`); "Selecione um lead e sua oportunidade." → `"Oportunidade inválida."`; "O fim deve ser depois do início." → `"Duração mínima: 5 minutos."` (mesma regra `endMin <= startMin` cai no `min(5)`); "O link deve começar com https://." → "Link deve começar com https://." (mesmo regex); max de observacoes identico. Falha de save ganha `toast.error` + inline (antes: so banner); validacao client falha ganha auto-focus (antes: inline sem foco); transicoes continuam sem toast.
- **AgentsPanel**: `escalationRules.*` continua SEM exibicao inline (o `zodErrors` pontuado nunca casou com o display original — paridade); budget preserva as 3 mensagens via pre-checagem; gating do botao "Adicionar documento" removido (erro passa a aparecer no clique).
- **TemplateManager**: falha de preview continua sem toast (so inline/banner); falha de save ganha `toast.error` (padrao 042, antes: so banner do `useActionState`).

### Testes executados (VERIFIED)
- `npx tsc --noEmit` — **VERIFIED**, 0 erros.
- `npm run lint` — **VERIFIED**, 0 erros (14 warnings: 8 pre-existentes `src/lib/billing/**`, 6 `react-hooks/incompatible-library`/`Compilation Skipped` pelo `watch()` — 2 vindos da 043 + 4 dos forms novos — mesmas limitacoes ja aceitas na 042/043).
- `npm test` — **VERIFIED** com ressalva: 123 arquivos, 1492/1493 testes; a 1 falha e `src/lib/mobile/alerts.test.ts` (intermitente de dados/paralelismo), **pre-existente**: reproduzida com `git stash` (working tree limpo) e o arquivo isolado (`npx vitest run src/lib/mobile/alerts.test.ts`) passa 24/24. Sem regressao das mudanças 044 (nenhum teste cobre os componentes alterados; contrato de actions/schemas intocado — `git status` sem alteracoes em `src/lib/**`).
- `npm run build` — **VERIFIED**, `next build` OK.

### Criterios de aceitacao

| Criterio | Status | Evidencia |
|---|---|---|
| Todos os 5 arquivos migrados ou no-op documentado, mesmo comportamento de validacao client+server | PASS | 4 migrados (`SequenceBuilder`, `TemplateManager`, `AgentsPanel` com AgentForm/GlobalBudget/Knowledge/Simulate, `MeetingDialog`); 1 no-op (`DraftQueue`, sem captura/payload, ver secao). Client = mesmos schemas `src/lib/schemas/*`; actions continuam re-validando (`input: unknown`) |
| Nenhuma regressao nos testes existentes | PASS | `npm test` 1492/1493; unica falha `alerts.test.ts` intermitente e pre-existente (reproduzida com `git stash`; isolado 24/24) |
| build/lint/typecheck OK | PASS | `tsc --noEmit` 0 erros; `eslint` 0 erros (14 warnings aceitos); `next build` OK |

### Decisoes arquiteturais herdadas/estendidas
- Mesmo padrao 042/043: `z.preprocess` adaptando a forma do form (strings de UI, `key` de step, `subject` condicional) sem duplicar regra — o schema validado e literalmente o exportado de `src/lib/schemas/*`.
- Erros de server via `setError` por chave + `_form` → `setError("root")` + banner + `toast.error(getFormError)` + `setFocus(primeiro)`. `setFocus` em path nao registrado (`startsAt`, `opportunityId`, `steps.0.day`) e no-op seguro (verificado no fonte do RHF: so foca se houver `ref`).
- **Budget: pre-checagem em `onValid`** em vez de schema client — `resolveBudgetInput` e regra so da UI (o schema aceita `null`), entao rodaria ANTES do resolver e derrubaria a validacao do schema; com a pre-checagem as mensagens originais ficam literais e o erro sai do resolver (null) para nao duplicar.
- **`KnowledgeSection` como form proprio** com submit explicito — evita `<form>` aninhado (invalido no HTML) sem sair do RHF.

### Limitacoes conhecidas
- Sem suite de testes de componente (`vitest` em `environment: "node"`) — validacao via `tsc`/`eslint`/`npm test`/`next build` + revisao do diff contra `git show HEAD:`, como 042/043.
- 4 warnings novos `react-hooks/incompatible-library` (`watch()`, total 6 com os da 043): mesmas implicacoes ja documentadas na 043 (React Compiler pula memoization; nao afeta funcionalidade; se o gate virar "0 warnings", migrar para `useWatch`).

### QA (2026-09-28) — QA APPROVED (manual; subagent qa-reviewer indisponivel por config de model)
Revisao de paridade contra `git show HEAD:` dos 4 arquivos migrados + reexecucao dos gates:
- **Paridade**: JSX/labels/placeholders/hints/classes preservados literalmente (incluindo detalhes triviais restaurados durante a revisao: `shrink-0` do icone de conflito, `text-muted-foreground` do LeadPicker, classes de focus dos selects do AgentsPanel); nenhum schema em `src/lib/schemas/*` nem action em `src/lib/actions/` alterados (`git status` limpo fora dos 5 componentes + specs). Toasts existentes mantidos (`"Sequência criada."`, warnings de conflito/aviso de template, transicoes).
- **Deltas aceitos (todos documentados acima)**: mensagens do schema substituindo as strings avulsas do `validate()`/checks manuais (regras identicas ou as mesmas que o server ja retornava); auto-focus no 1o invalido; `toast.error(getFormError)` no save do MeetingDialog/TemplateForm (padrao 042, antes so banner); gating do "Adicionar documento" removido (erro inline).
- **Gates reexecutados**: `npx tsc --noEmit` → 0 erros; `npm run lint` → 0 erros (14 warnings documentados); `npm test` → 1492/1493 com falha pre-existente comprovada via `git stash` + execucao isolada; `npm run build` → OK.
