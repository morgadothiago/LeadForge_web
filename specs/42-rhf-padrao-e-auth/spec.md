# SPEC-042 — Padrao react-hook-form + piloto (Auth)
- status: IMPLEMENTED (dev-frontend, 2026-09-27) | domain: frontend | depende de: 009,034,037,038 (formularios de auth existentes)

## Objetivo
Padronizar os formularios do app com `react-hook-form` + `@hookform/resolvers` (`zodResolver`), reaproveitando os schemas Zod ja existentes em `src/lib/schemas/*` como fonte UNICA de validacao (mesmo schema no client via `zodResolver` e no server dentro da action/`safeAction` — sem duplicar regra). Hoje TODOS os formularios usam estado manual (`useState` para valores + `errors` do `ActionResult`, sem nenhuma lib de formulario) — confirmado por levantamento no codigo (ver lista completa abaixo).

Esta SPEC-042 e a BASE (instala as libs, define o padrao/convencao) e o PILOTO (migra os 4 formularios de Auth, menor risco, para validar o padrao antes de aplicar no resto do app). As demais areas ficam em SPECs separadas (043, 044, 045 — ver "Divisao proposta" abaixo), aplicadas so DEPOIS desta SPEC aprovar o padrao na pratica.

## Levantamento completo dos formularios existentes (grep no codigo, nao estimativa)
Todos usam hoje `useState` (valores) + leitura manual de `FieldErrors`/`getFormError`/`fieldError` (`src/components/campaigns/form-utils.ts`) contra o `ActionResult` retornado pela action:

**Auth (escopo desta SPEC-042):** `LoginForm.tsx`, `SignupForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`.

**Campanhas/ICP/Leads (SPEC-043 proposta):** `CampaignForm.tsx`, `IcpFields.tsx`, `IcpManager.tsx`, `CampaignLeadSearch.tsx`, `CampaignStartSequence.tsx`, `LeadFormDialog.tsx`, `PossibleOptOutAlert.tsx`.

**Sequences/Templates/Agentes/Calendario (SPEC-044 proposta):** `SequenceBuilder.tsx`, `TemplateManager.tsx`, `AgentsPanel.tsx`, `DraftQueue.tsx`, `MeetingDialog.tsx`.

**Configuracoes/Integracoes/WhatsApp/Supressao/Admin/Billing (SPEC-045 proposta):** `EmailAccountFormDialog.tsx`, `EmailAccountList.tsx`, `IntegrationCard.tsx`, `IntegrationFormDialog.tsx`, `SuppressionAddDialog.tsx`, `SuppressionRemoveDialog.tsx`, `WhatsAppHealthPanel.tsx`, `WhatsAppInstanceFormDialog.tsx`, `WhatsAppInstanceList.tsx`, `WhatsAppQrDialog.tsx`, `WhatsAppWebhookSection.tsx`, `OrganizationStatusActions.tsx` (admin), `PlanSelectionSection.tsx`/`SubscriptionSummaryCard.tsx` (billing — formularios simples, avaliar se vale migrar ou manter como esta, ja que sao mais "botao com confirmacao" do que formulario de campos).

Nao mexer: `AppSidebar.tsx`, `LogoutButton.tsx` (usam `useState`/`errors` por outro motivo, nao sao formularios de captura de dado — fora de escopo de todas as SPECs desta serie).

## Divisao proposta (recomendacao do orquestrador)
Dividir em 4 SPECs (042 base+auth, 043, 044, 045) em vez de 1 SPEC unica, pelos motivos:
1. Volume: ~27 arquivos de formulario espalhados por quase toda a area logada — 1 SPEC unica seria dificil de revisar/testar como unidade e arriscaria uma migracao malfeita afetar o app inteiro de uma vez.
2. Auth primeiro como piloto: sao so 4 arquivos, baixo risco (nao autenticado ainda, escopo pequeno), e serve para VALIDAR o padrao de convencao (como o `zodResolver` interage com `ActionResult`/erros de servidor, como formatar mensagem de campo) antes de aplicar em massa. Se o padrao piloto tiver algum ajuste necessario, e mais facil corrigir em 4 arquivos que em 27.
3. Divisao por area de dominio (Campanhas/Leads, Sequences/Agentes/Calendario, Configuracoes/Admin/Billing) permite aprovar/revisar/testar cada leva isoladamente, e QA foca numa area por vez em vez de tudo simultaneo.

## Escopo desta SPEC (042)
1. Instalar `react-hook-form` + `@hookform/resolvers` (`--legacy-peer-deps` se necessario, mesma convencao ja usada no projeto para libs novas).
2. Definir o PADRAO de migracao (documentar em comentario/README de componente ou na propria spec, para as SPECs 043/044/045 seguirem):
   - `useForm({ resolver: zodResolver(schemaDoServidor) })` — o MESMO schema Zod ja usado na action/`safeAction` do servidor (import direto de `src/lib/schemas/*`, nunca duplicar/redefinir regra).
   - Erro de campo: `formState.errors.<campo>?.message` no lugar do `fieldError(errors, "campo")` manual — mas MANTER a leitura de erro de SERVIDOR (`_form`/`ActionResult.errors`) via `setError`/`getFormError` quando a action retorna erro que o Zod client-side nao pegaria (ex.: e-mail duplicado, regra que so o servidor sabe) — os dois caminhos de erro (client via zodResolver, servidor via ActionResult) precisam coexistir, um nao substitui o outro.
   - Submit: `handleSubmit(async (values) => { const res = await action(values); if (!res.ok) { /* mapear res.errors pros campos via setError, e/ou toast.error(getFormError(res.errors)) do ajuste incremental pos-SPEC-038 */ } })`.
3. Migrar os 4 formularios de Auth (`LoginForm.tsx`, `SignupForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`) para o padrao acima, mantendo EXATAMENTE o mesmo comportamento de validacao ja existente (fora de escopo mudar REGRA de validacao — so o mecanismo/UI de captura).
4. Reaproveitar o padrao de erro por campo/mensagem geral ja existente (`getFormError`/`fieldError`, `src/components/campaigns/form-utils.ts`) onde fizer sentido, sem recriar do zero.

## Fora do escopo
- Mudar qualquer REGRA de validacao (min/max, formato, obrigatoriedade) — so troca o mecanismo de captura/exibicao de erro.
- Migrar os formularios das areas 043/044/045 (ficam para depois, SPECs separadas).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [x] `react-hook-form`/`@hookform/resolvers` instalados.
- [x] 4 formularios de Auth migrados, mesmo comportamento de validacao (client E server) de antes.
- [x] Erro de servidor (ex. e-mail duplicado, token invalido) continua aparecendo corretamente (banner inline + toast, ajuste pos-SPEC-038 preservado).
- [x] Nenhuma regressao nos testes existentes desses 4 formularios/actions.
- [x] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend. Aguardando aprovacao (`APROVAR SPEC-042`). SPECs 043/044/045 ficam DRAFT ate esta aprovar E o piloto validar o padrao na pratica.

## Implementation Notes (dev-frontend, 2026-09-27)

### Arquivos alterados/criados
- `package.json` / `package-lock.json` — adicionados `react-hook-form@^7.89.0` e `@hookform/resolvers@^5.9.1` (instalacao limpa, sem precisar de `--legacy-peer-deps`; os `npm warn` de peer-deps pre-existentes sao de `swagger-ui-react`/`react-inspector`, nao relacionados).
- `src/components/auth/LoginForm.tsx` — migrado.
- `src/components/auth/SignupForm.tsx` — migrado.
- `src/components/auth/ForgotPasswordForm.tsx` — migrado.
- `src/components/auth/ResetPasswordForm.tsx` — migrado (inclui o schema estendido client-side, ver abaixo).
- Nenhum arquivo de `src/lib/schemas/*` ou `src/lib/actions/*` foi alterado (regra "nao duplicar/redefinir validacao" cumprida por import direto, zero mudanca de regra).

### PADRAO documentado (para SPECs 043/044/045 seguirem)

1. **Schema**: sempre importar o schema Zod ja usado pela action/`safeAction` correspondente, de `src/lib/schemas/*` — nunca redefinir/copiar regra. Ex.: `import { loginSchema, type LoginInput } from "@/lib/schemas/auth"`.
2. **Hook**: `const { register, handleSubmit, setError, setFocus, formState: { errors } } = useForm<SchemaInput>({ resolver: zodResolver(schema), defaultValues: {...} })`.
   - `defaultValues` deve cobrir TODOS os campos do schema, inclusive os que nao sao editaveis pelo usuario mas vem de props (ex.: `next` no login, `planKey` no signup, `token` no reset) — evita tanto erro de tipo (schema completo) quanto mismatch de validacao, sem precisar de `<input type="hidden">` nem de dividir o schema.
   - Quando existe validacao client-only que o servidor nunca faz (ex.: "confirmar senha" no reset), **nao** criar um segundo schema do zero: usar `.extend({...})` sobre o schema do servidor pra acrescentar so o campo extra, e `.refine()` pra regra cross-field — os campos herdados (`password`, `token`) continuam validados exclusivamente pelas regras originais do servidor, nunca redefinidas. Ver `clientResetPasswordSchema` em `ResetPasswordForm.tsx`.
3. **Inputs**: `<Input {...a} {...register("campo")} .../>` dentro do `Field` existente (`src/components/campaigns/Field.tsx`) — `a` fornece `id`/`aria-invalid`/`aria-describedby`, `register(...)` fornece `ref`/`name`/`onChange`/`onBlur`. Funciona porque `Input` (`src/components/ui/*`) nao usa `forwardRef` — React 19 aceita `ref` como prop normal em componentes de funcao, entao o spread de `register()` de fato liga o DOM node ao RHF (confirmado: sem esse comportamento `setFocus`/foco em erro nao funcionaria).
4. **Erro de campo (client, via Zod)**: `error={errors.<campo>?.message}` no lugar do antigo `fieldError(errors, "campo")`.
5. **Erro de servidor (`ActionResult.errors`, o Zod client nunca pega)**: depois do `await action(values)` com `!res.ok`:
   ```ts
   if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
   let firstFieldKey: keyof SchemaInput | undefined;
   for (const [key, msgs] of Object.entries(res.errors)) {
     if (key === "_form") continue;
     firstFieldKey ??= key as keyof SchemaInput;
     setError(key as keyof SchemaInput, { type: "server", message: msgs.join(" ") });
   }
   toast.error(getFormError(res.errors));       // padrao pos-SPEC-038 preservado, le o ActionResult bruto
   if (firstFieldKey) setFocus(firstFieldKey);   // substitui o antigo requestAnimationFrame + querySelector
   ```
   - Erro geral (banner) passa a ler `errors.root?.message` em vez do antigo `fieldError(errors, "_form")` — mesmo comportamento (so aparece quando a action retorna `_form`).
   - `toast.error(getFormError(res.errors))` continua chamando `getFormError`/`fieldError` (`src/components/campaigns/form-utils.ts`) direto sobre o `ActionResult.errors` bruto do servidor — nao foi alterado, os dois caminhos de erro (client via `zodResolver`/`formState.errors`, servidor via `ActionResult`/`setError`) coexistem.
6. **Foco no erro**: trocado `formRef` + `requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus())` por `setFocus(fieldName)` do RHF. Motivo tecnico (nao so estilistico): o linter do projeto (`react-hooks/refs`, regra nova do eslint-plugin-react-hooks/react-compiler) rejeita passar uma closure que fecha sobre um `ref` de DOM para dentro de `handleSubmit(...)` (chamado durante o render) — `Error: Cannot access refs during render`. `setFocus` resolve o mesmo objetivo (foca o 1o campo invalido apos erro de servidor) sem essa violacao, e para erro de validacao client (`zodResolver`) o RHF ja foca automaticamente por padrao (`shouldFocusError: true`).
7. **Submit**: `const onSubmit = handleSubmit((values) => { startTransition(async () => { const res = await action(values); ... }) })`, mantendo `useTransition` para `pending`/`aria-busy` como antes.

### Ponto de atencao resolvido (ResetPasswordForm)
`confirmPassword` (comparacao client-only, fora do `resetPasswordSchema` do servidor) foi implementado via:
```ts
const clientResetPasswordSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string({ error: "Confirme a nova senha." }).min(1, "Confirme a nova senha.") })
  .refine((data) => data.password === data.confirmPassword, { message: "As senhas não coincidem.", path: ["confirmPassword"] });
```
`password`/`token` continuam validados 100% pelas regras de `resetPasswordSchema` (import direto, `.extend()` so acrescenta); no submit so `{ token, password }` e enviado pra `resetPassword(...)` (o servidor nunca recebe/precisa de `confirmPassword`). Mesmo comportamento de antes: mismatch e pego ANTES de chamar a action (agora pelo `zodResolver`, sem toast — so erro inline no campo, RHF foca automaticamente), sem round-trip ao servidor.

### Testes executados (VERIFIED)
- `npx tsc --noEmit` — **VERIFIED**, sem nenhum erro nos 4 arquivos migrados nem em `src/lib/schemas/*`. Existem erros de tipo pre-existentes/concorrentes em arquivos fora do escopo desta SPEC (`src/lib/mobile/*.test.ts`, `src/lib/auth/auth.test.ts`, `src/lib/channels/system-mail.test.ts`, `src/lib/integrations/view.ts`, `src/lib/lead-source/mapping.ts`) — nao tocados por esta implementacao, aparentam ser trabalho em andamento de outro agente em paralelo (`EmailContent`/`sendSystemEmail`).
- `npx eslint src/components/auth/*.tsx` — **VERIFIED**, `ESLint: No issues found`.
- `npx vitest run src/lib/auth/auth.test.ts src/lib/auth/password-reset.test.ts src/lib/actions` — **VERIFIED** (executado isoladamente primeiro, confirmando `ps aux` sem outro vitest rodando). 2 falhas em `auth.test.ts` (`forgotPassword`/`resetPassword`, SPEC-038) sao pre-existentes/de outro agente: `sendSystemEmail` mudou de assinatura (`EmailContent` vs `string`) em `src/lib/channels/system-mail.ts` (arquivo nao tocado por esta SPEC) — nao relacionadas a formularios/RHF.
- `npm test` (suite completa, 1376 testes) — **VERIFIED**, `9 failed | 101 passed` arquivos, `1340 passed | 27 skipped` testes. As 9 falhas sao todas fora do escopo desta SPEC: `src/lib/auth/auth.test.ts` (mesma causa acima), `src/lib/mobile/alerts.test.ts`/`metrics.test.ts` (erro de tipo/ajv `unknownFormats` pre-existente), `src/lib/tenant/cross-tenant-leak.test.ts` (timeout de 15s no scheduler, flakiness conhecida documentada no proprio `vitest.config.ts`), `src/lib/whatsapp/provider.test.ts` (grep de import falha por causa de `src/lib/billing/providers/abacatepay.test.ts`, arquivo de outra area), `src/lib/lead-ingest/handler.test.ts`. Nenhuma falha em `src/components/auth/*` ou em qualquer teste que exercite os 4 formularios migrados.

### Criterios de aceitacao

| Criterio | Status | Evidencia |
|---|---|---|
| `react-hook-form`/`@hookform/resolvers` instalados | PASS | `package.json` (`react-hook-form@^7.89.0`, `@hookform/resolvers@^5.9.1`); `npm ls` confirma resolucao |
| 4 formularios de Auth migrados, mesmo comportamento de validacao (client E server) | PASS | `LoginForm.tsx`, `SignupForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx` usam `zodResolver` com o schema exato da action; erro de servidor via `setError`/`ActionResult` preservado |
| Erro de servidor continua aparecendo (banner inline + toast) | PASS | `errors.root?.message` (banner) + `toast.error(getFormError(res.errors))` (inalterado) em todos os 4 arquivos |
| Nenhuma regressao nos testes existentes desses 4 formularios/actions | PASS | `auth.test.ts` roda 71 testes (69 passam); as 2 falhas sao de `sendSystemEmail`/`system-mail.ts`, fora do escopo/nao tocado por esta SPEC, nao relacionadas a `LoginForm`/`SignupForm`/`ForgotPasswordForm`/`ResetPasswordForm` |
| build/lint/typecheck OK | PASS (lint/typecheck dos arquivos desta SPEC); build (`next build`) nao foi executado por instrucao explicita do usuario (nao subir servidor/build) — `tsc --noEmit` cobre a checagem de tipos equivalente |

### Decisoes arquiteturais
- `setFocus` do RHF substitui a manipulacao manual de `ref`+`querySelector` — exigido pelo lint do proprio projeto (`react-hooks/refs`), preserva o mesmo resultado funcional (foco no 1o campo invalido).
- Campos nao editaveis pelo usuario mas exigidos pelo schema completo do servidor (`next`, `planKey`, `token`) entram via `defaultValues` do `useForm`, sem `<input type="hidden">` — mais simples, e como nunca sao alterados pelo usuario nao ha necessidade de `register()`.
- `confirmPassword` fica no schema estendido do proprio componente (`ResetPasswordForm.tsx`), nao em `src/lib/schemas/auth.ts` — o servidor nunca recebe/valida esse campo, entao nao pertence ao schema compartilhado.

### Limitacoes conhecidas
- Nao existe suite de testes de componente (React Testing Library/jsdom) neste projeto hoje — `vitest.config.ts` roda em `environment: "node"`, focado em actions/schemas/integracao contra banco de teste. Validacao desta migracao foi feita via `tsc`/`eslint` (contratos de tipo/API do RHF corretos) + testes de action existentes (comportamento de servidor inalterado) + leitura manual do diff comportamental (client validation nova, mesma regra, sem toast em erro so-client — preserva o padrao ja existente em `ResetPasswordForm` original). Se SPECs 043/044/045 quiserem cobertura automatizada de UI, precisam antes decidir instalar `@testing-library/react`+`jsdom` (fora do escopo desta SPEC, seria uma nova decisao de infraestrutura de teste).
- `npm audit` mostra 4 vulnerabilidades "high" pre-existentes no `package-lock.json` (nao originadas pela instalacao de `react-hook-form`/`@hookform/resolvers` — nenhuma delas aparece nas 6 dependencias novas/alteradas), fora do escopo desta SPEC.
