# SPEC-043 — react-hook-form: Campanhas, ICP, Leads
- status: IMPLEMENTED (dev-frontend, 2026-09-27; QA APPROVED) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao `react-hook-form`+`zodResolver` definido/validado na SPEC-042 os formularios de: `CampaignForm.tsx`, `IcpFields.tsx`, `IcpManager.tsx`, `CampaignLeadSearch.tsx`, `CampaignStartSequence.tsx`, `LeadFormDialog.tsx`, `PossibleOptOutAlert.tsx`.

## Escopo
Mesmo padrao da SPEC-042 (`useForm({resolver: zodResolver(schema)})` com o schema Zod ja usado na action correspondente, erro de servidor via `setError`/`getFormError`, mesmo comportamento de validacao de hoje). Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [x] Todos os 7 arquivos migrados, mesmo comportamento de validacao client+server de antes.
- [x] Nenhuma regressao nos testes existentes.
- [x] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aguardando aprovacao (`APROVAR SPEC-043`).

## Implementation Notes (dev-frontend, 2026-09-27)

### Arquivos alterados/criados
- `src/components/campaigns/CampaignForm.tsx` — migrado. `useForm<CampaignFormValues, unknown, CampaignSubmit>` + `zodResolver(z.preprocess(...))`; `useState` de valores/`errors` removidos; server errors via `setError`/`setFocus`/`toast.error(getFormError(...))`.
- `src/components/campaigns/IcpFields.tsx` — migrado. Deixa de receber `values`/`onChange` (estado manual); agora recebe `register`/`errors` do form-pai e exibe erros via `rhfErrorAt` (suporta subcaminhos `icp.*` do create e chaves planas do dialogo de gestao).
- `src/components/campaigns/IcpManager.tsx` — so o `IcpFormDialog` migrado (create via `icpInputSchema`, edit via `icpUpdateSchema`, ambos com `z.preprocess` que converte listas de texto em arrays com `toIcpInput`). Lista/delete do IcpManager nao e form de captura — inalterado.
- `src/components/leads/LeadFormDialog.tsx` — migrado. `useForm` + `zodResolver(createLeadSchema)` no create; no edit `z.preprocess((v) => ({...v, leadId}), clientUpdateLeadSchema)`. Telefone via `Controller` + `maskBrPhone` (mascara preservada). Export `LeadFormValues` (tipo do prop de lead usado por `LeadActions`) mantido intacto.
- `src/components/campaigns/form-utils.ts` — helpers legados (`getFormError`, `EMPTY_ICP`, `toIcpInput`, `icpToValues`) mantidos; acrescentados `collectMessages`/`rhfErrorAt` para ler `formState.errors` aninhados/arrays.

### No-op documentado (3 dos 7 arquivos da lista do Objetivo)
`CampaignLeadSearch.tsx` (dialogo de BUSCA/selecao de leads — o estado `error/result` e de resultado de acao, nao de captura), `CampaignStartSequence.tsx` (dialogo de confirmacao de start + checkbox de gating, sem schema de submissao) e `PossibleOptOutAlert.tsx` (alerta de confirmacao) **nao contem campos de captura** — fora da definicao de "formulario" que a SPEC-042 usou para migrar (formularios que submetem valores a uma action com schema Zod). Reavaliados na sessao de 2026-09-27: nenhum deles possui `useState` de valores de form nem envio de payload validado por schema, entao nao ha o que migrar para `zodResolver`; deixar RHF ali seria so mais uma dependencia de estado sem beneficio. Os 4 arquivos com campos de captura (`CampaignForm`, `IcpFields`, `IcpManager/IcpFormDialog`, `LeadFormDialog`) foram migrados.

### PADRAO aplicado (herdado da SPEC-042, com 4 extensoes desta SPEC)
1. **Adapter via `z.preprocess` no topo do schema** — os formularios tem estado com strings de UI (listas do ICP separadas por virgula, `""` em vez de `null`/`undefined`), entao o `resolver` e `zodResolver(z.preprocess(fnConvert, schemaDaAction))`. A regra de validacao NAO e duplicada: o schema validado e literalmente o mesmo exportado de `src/lib/schemas/*` (`campaignCreateSchema`/`campaignUpdateSchema`, `icpInputSchema`/`icpUpdateSchema`, `createLeadSchema`/`updateLeadSchema`); o `fnConvert` so adapta a FORMA. A action continua re-validando no servidor (`input: unknown`), nao ha caminho que fuja do schema.
2. **`z.preprocess` exige anotar o param** (`(v: CampaignFormValues) => ...`) — o overload zod4 do `zodResolver` tipa `Resolver<z.input<T>, ...>` com `Input extends FieldValues`; sem a anotacao o `Input` cai no `any` e o `Resolver` nao casa com `useForm`.
3. **Erro de servidor via `setError` por chave** — `zodErrors` do `ActionResult` usa `path.join(".")`; chaves pontuadas/numéricas (`icp.signals.0`) sao passadas direto ao `setError` (o RHF aceita caminhos profundos) com cast `as FieldPath<T>`; `_form` vira `setError("root", ...)` + `toast.error(getFormError(errs))` (banner `errors.root?.message` ja era renderizado, agora preenchido pelo root); depois `setFocus(primeiro campo, colapsando `.\\d+$`)`. No success, `toast.success` (antes: redirecionamento silencioso) — aderencia ao padrao 042.
4. **`LeadFormState` = exatamente `z.input<typeof createLeadSchema>`** — ver "Ponto de atencao resolvido" abaixo.

### Ponto de atencao resolvido (variancia do `ResolverOptions`)
A primeira versao usou um `interface LeadFormState { campaignId: string; name: string; company: string; ... }` "parecida" com o input do schema. O `tsc` rejeitou a atribuição do `zodResolver(createLeadSchema)` a `Resolver<LeadFormState, ...>` com um erro opaco (`Type 'string | null | undefined' is not assignable to type 'string'` apontando para `ResolverOptions`). Causa: o `ResolverOptions<TFieldValues>` do RHF so depende de `T` via `names?: FieldName<T>[]` (conditional `IsFlatObject<T>`), e o TS relaciona `ResolverOptions<A>`/`ResolverOptions<B>` pela variancia do tipo-argumento quando as structuras de `A`/`B` diferem (`company: string` vs `company?: string | null`), em vez do caminho estrutural — que falha na direcao "contravariante". Solucao: tipar o estado do form como o proprio `z.input<typeof createLeadSchema>` (alias, nao interface nova) — identico ao `Input` do resolver, entao nao ha comparacao de argumentos diferentes. Valida com `npx tsc --noEmit` (0 erros) e reproduzido isoladamente num repro minimo. Vale o mesmo aviso para as SPECs 044/045: **tipar o estado do form a partir de `z.input<typeof schema>`, nao re-declarar a interface**.

### Outras decisoes desta migracao
- **`IcpFields` como wrapper generico**: props `idPrefix`, `prefix` (`"icp."` no create da campanha / `""` no dialogo de gestao), `register: (name: string) => UseFormRegisterReturn` e `errors: unknown`; o pai passa `(n) => register(n as FieldPath<T>)` e a exibicao usa `rhfErrorAt` (retorna `string | undefined`, unico formato que `Field.error` aceita). Erros tipados de campos planos saem direto de `formState.errors` (`errors.name?.message` etc).
- **`updateLeadSchema` nao tem refine de contato** (a action checa e devolve `failure({email: [MIN_CONTACT_MSG]})`): criado `clientUpdateLeadSchema = updateLeadSchema.superRefine(...)` espelhando a MESMA regra e a MESMA mensagem (`MIN_CONTACT_MSG`, importado do schema) — mesmo comportamento client/server da SPEC-042 (`clientResetPasswordSchema`). No `onError` do `handleSubmit`, quando o erro e `MIN_CONTACT_MSG` ele tambem e setado em `phone` (preserva a UX atual do `clientErrors` que mostrava a mensagem nos dois campos). **Unica mudanca de texto**: o check client-only antigo usava a string avulsa `"Informe e-mail ou telefone."`; agora usa o `MIN_CONTACT_MSG` do schema (a mesma mensagem que o servidor ja retornava) — regra identica, mensagem alinhada a fonte unica.
- **Mascara de telefone via `Controller`** do RHF (`onChange: maskBrPhone(target.value)`), valor via `field.value ?? ""` (o input do schema permite `null`, o DOM nao); `normalizeBrPhone` e idempotente para e164 (verificado em `src/lib/domain/phone.ts`), entao re-mascarar no submit nao quebra a action.
- **`source` (Origem) no edit**: o form original fazia `source || undefined` (vazia = NAO alterar — a origem registra a captacao do lead). Preservado no `preprocess` de edicao (`source: v.source || undefined`); no create o resultado e identico (`""`/`undefined` → action default `?? "manual"`). Demais campos vazios continuam limpando (`null`), como antes.
- **Toasts**: sucesso (`toast.success` nos 3 submits) ja existiam e foram preservados literalmente; o `toast.error(getFormError(...))` em falha de servidor e NOVO — aderencia deliberada ao padrao da SPEC-042 (antes: so banner inline, que continua presente via `errors.root?.message`). O `toast.warning` de supressao do `LeadFormDialog` foi preservado.
- **`OptionSelect`/toggle/autoStart por `watch`+`setValue`** (selects de status/ICP/sequencia/WhatsApp, checkbox `autoStart`, modo `icpMode` continua `useState` fora do form — nao e valor submetido).
- **Zero `any`** em `src/components` (padrao do lint do projeto). Unicos casts: chaves de `ActionResult.errors`/nomes do `register` para `FieldPath<T>` — pontuais e documentados.
- **`noValidate` no `<form>`** em todos (mesmo comportamento do 042: validacao 100% pelo resolver, sem validacao nativa do browser).

### Testes executados (VERIFIED)
- `npx tsc --noEmit` — **VERIFIED**, 0 erros.
- `npm run lint` — **VERIFIED**, 0 erros (10 warnings: 8 pre-existentes em `src/lib/billing/**`, nao tocados; 2 novos `react-hooks/incompatible-library` pelo `watch()` do RHF em `CampaignForm`/`LeadFormDialog` — ver Limitacoes).
- `npm test` — **VERIFIED**, 123 arquivos / 1493 testes, 100% verdes (sem regressao; cobre actions/schemas que continuam o contrato de servidor inalterado).
- `npm run build` — **VERIFIED**, `next build` OK.

### Criterios de aceitacao

| Criterio | Status | Evidencia |
|---|---|---|
| Todos os 7 arquivos migrados, mesmo comportamento de validacao client+server | PASS | 4 com campos de captura migrados (`CampaignForm`, `IcpFields`, `IcpManager/IcpFormDialog`, `LeadFormDialog`); 3 no-op documentados (busca/confirmacao/alerta — sem payload validado por schema, ver secao "No-op documentado"). Validacao client = mesmo schema da action; server action continua re-validando |
| Nenhuma regressao nos testes existentes | PASS | `npm test` 123/123 arquivos e 1493/1493 testes verdes |
| build/lint/typecheck OK | PASS | `tsc --noEmit` 0 erros; `eslint` 0 erros; `next build` OK |

### Decisoes arquiteturais
- Adapter `z.preprocess` (e nao schema novo client-side) para manter `src/lib/schemas/*` como fonte unica — as regras (min/max/refine/transform) rodam exatamente igual no client (resolver) e no server (action).
- `clientUpdateLeadSchema` (`.superRefine` com `MIN_CONTACT_MSG`/path `email`) vive no componente, nao em `src/lib/schemas/lead.ts` — espelha o check da action sem alterar o schema compartilhado (mesmo racional do `clientResetPasswordSchema` do 042).
- `IcpFormDialog` renderizado condicionalmente (`{creating && ...}` / `{editing && ...}` com `key={editing.id}`) — remonta a cada abertura, entao `defaultValues`/erros limpos sem `reset` explicito (o dialogo antigo limpava `errors` no `onOpenChange`).

### Limitacoes conhecidas
- Sem suite de testes de componente (`vitest` em `environment: "node"`) — validacao via `tsc`/`eslint`/`npm test`/`next build` + leitura do diff, como na SPEC-042. Se 044/045 quiserem cobertura de UI, decidir antes instalar `@testing-library/react`+`jsdom`.
- 2 warnings novos `react-hooks/incompatible-library` (`watch()` do RHF): o React Compiler pula o memoization do componente (`Compilation Skipped`) — nao afeta funcionalidade (RHF re-renderiza por assinatura de campo), e `watch` e a API canonica para valores vivos; sao warnings, o gate de lint (0 erros) passa. Se o gate mudar para "0 warnings", trocar por `useWatch({control, name})` e reavaliar.

### QA (2026-09-27) — QA APPROVED (manual; subagent qa-reviewer indisponivel por config de model)
Revisao de paridade contra `git show HEAD:` dos 4 arquivos migrados + reexecucao dos gates:
- **Paridade**: JSX/labels/placeholders/hints preservados literalmente (textarea class, toggle autoStart, cancel/link, mensagens dos schemas — nenhum schema em `src/lib/schemas/*` nem action em `src/lib/actions/` alterados, confirmado por `git status`). Toasts de sucesso + `toast.warning` de supressao ja existiam e foram mantidos; banner `errors.root?.message` preenchido de forma equivalente ao antigo `fieldError(errors, "_form")`.
- **Deltas aceitos (todos documentados acima)**: (1) `toast.error(getFormError(...))` em falha de servidor — padrao 042; (2) mensagem client do "ao menos um contato" agora = `MIN_CONTACT_MSG` do schema (antes string avulsa `"Informe e-mail ou telefone."`); (3) selecao vazia de ICP no create: `icpId null` (antigo) quebrava `z.uuid` com `"ICP inválido."` → agora `undefined` cai no superRefine do proprio schema com `"Selecione um ICP existente ou preencha um novo."` (mesma regra "exatamente um", mensagem desenhada para esse caso); (4) foco automatico no 1o campo invalido (`shouldFocusError` do RHF, padrao 042); (5) ids dos campos do `LeadFormDialog` fixos (`lead-*`) em vez de `useId` — so um modal Radix aberto por vez, sem colisao.
- **Gates reexecutados**: `npx tsc --noEmit` → 0 erros; `npm run lint` → 0 erros (10 warnings: 8 pre-existentes `src/lib/billing/**`, 2 `react-hooks/incompatible-library` novos por `watch()`, ja documentados); `npm test` → 123/123 arquivos e **1493/1493 testes verdes** (executado 2x); `npm run build` → OK.
- `fieldError`/`getFormError` legados mantidos em `form-utils.ts` — ainda usados pelos arquivos das SPECs 044/045 (nao migrados aqui).
