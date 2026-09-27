# SPEC-042 — Padrao react-hook-form + piloto (Auth)
- status: APPROVED (usuario, 2026-09-27) | domain: frontend | depende de: 009,034,037,038 (formularios de auth existentes)

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
- [ ] `react-hook-form`/`@hookform/resolvers` instalados.
- [ ] 4 formularios de Auth migrados, mesmo comportamento de validacao (client E server) de antes.
- [ ] Erro de servidor (ex. e-mail duplicado, token invalido) continua aparecendo corretamente (banner inline + toast, ajuste pos-SPEC-038 preservado).
- [ ] Nenhuma regressao nos testes existentes desses 4 formularios/actions.
- [ ] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend. Aguardando aprovacao (`APROVAR SPEC-042`). SPECs 043/044/045 ficam DRAFT ate esta aprovar E o piloto validar o padrao na pratica.
