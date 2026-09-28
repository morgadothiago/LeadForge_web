# SPEC-046 — E-mail transacional: Resend (com fallback SMTP) + templates HTML + 2 cenarios novos
- status: IMPLEMENTED (dev-backend, 2026-09-27; QA APPROVED) | domain: backend | depende de: 010 (SMTP/Nodemailer), 033 (billing), 037 (identidade visual), 038 (esqueci-senha), 039 (lembretes), 040 (cortesia)

## Objetivo
Hoje `sendSystemEmail` (`src/lib/channels/system-mail.ts`) e SMTP/Nodemailer puro, texto plano, usado em 3 cenarios: esqueci-senha (SPEC-038), lembretes de cobranca (SPEC-039, 4 sub-tipos: trial acabando, inicio do past_due, suspensao automatica, aviso de expurgo) e boas-vindas de conta cortesia (SPEC-040). O usuario quer: (1) trocar/estender para usar Resend (API HTTP) com fallback automatico pro SMTP existente se a chave nao estiver configurada; (2) HTML com a identidade visual da SPEC-037 em vez de texto puro, com fallback de texto no mesmo envio (multipart); (3) 2 cenarios novos que nao existem hoje — confirmacao de assinatura efetuada e confirmacao de assinatura cancelada.

## Contexto (verdade-base, ja levantado, nao repetir exploracao)
- `src/lib/channels/system-mail.ts`: SMTP puro hoje, reaproveita `normalizeSmtpError`/`resolvePublicHost` (anti-SSRF, SPEC-010) — essa logica de seguranca deve ser preservada no adapter SMTP, nao descartada.
- 3 callsites atuais: `src/lib/actions/auth.ts:102` (esqueci-senha), `src/lib/billing/reminders.ts:62` (lembretes), `src/lib/actions/admin/organizations.ts:119` (boas-vindas cortesia).
- 2 cenarios NOVOS, sem callsite hoje: "assinatura efetuada com sucesso" (disparar dentro de `processBillingEvent`, `src/lib/billing/process-event.ts`, SPEC-033, no processamento do evento de checkout bem-sucedido) e "assinatura cancelada" (disparar no mesmo ponto que `status-map.ts` transiciona `Subscription.status` para `canceled`).

## Escopo proposto
1. **Interface `EmailProvider`** (`send({to, subject, html, text})`), mesmo padrao arquitetural ja usado para `PaymentProvider` (D-33-5, trocavel por env): `src/lib/channels/email/provider.ts` (interface + factory por env), `providers/resend.ts` (novo, Resend API/SDK), `providers/smtp.ts` (extrai a logica atual do `system-mail.ts` pra ca, preservando anti-SSRF/`normalizeSmtpError`). `sendSystemEmail` continua sendo a UNICA funcao publica que os 5 callsites chamam — ela escolhe o adapter (Resend se `RESEND_API_KEY` setada, senao SMTP) e nunca deixa de tentar enviar se uma chave faltar/expirar (fallback automatico, nao erro fatal).
2. **Templates HTML** (1 helper por cenario, gera `{html, text}` a partir do mesmo dado, layout simples e consistente: header com logo/cor primaria da SPEC-037, corpo, rodape): `templates/password-reset.ts`, `templates/billing-reminder.ts` (4 variantes internas: trial_ending/past_due_started/auto_suspended/purge_warning), `templates/courtesy-welcome.ts`, `templates/subscription-success.ts` (NOVO), `templates/subscription-canceled.ts` (NOVO). HTML+CSS inline simples (sem MJML/react-email — nao esta no projeto, nao adicionar dependencia pesada so pra isso), responsivo o minimo necessario (largura maxima ~600px, fonte legivel em qualquer cliente de e-mail).
3. **Cenario novo 1 — assinatura efetuada com sucesso**: disparar dentro de `processBillingEvent` (`src/lib/billing/process-event.ts`) quando o evento processado resulta em `Subscription.status` indo para `active`/`trialing` a partir de um estado anterior sem assinatura ativa (checkout inicial) — conteudo: plano assinado, valor, data da proxima cobranca.
4. **Cenario novo 2 — assinatura cancelada**: disparar no mesmo ponto de `status-map.ts` que grava `canceledAt`/transiciona pra `canceled` — conteudo: confirmacao do cancelamento, data ate quando o acesso continua (fim do periodo pago, se aplicavel) e data da retencao/expurgo (90 dias, D-33-4).
5. `.env.example`: `RESEND_API_KEY` (opcional — ausente = fallback SMTP) e `RESEND_FROM_EMAIL` (ver D-046-1, Resend exige remetente de dominio verificado).
6. Testes: mock/fixture do Resend (nunca chamar API real), cobrindo os 5 cenarios (3 existentes + 2 novos) gerando html+text corretos, e o fallback SMTP automatico quando `RESEND_API_KEY` ausente/invalida.

## Fora do escopo
- Mudar o CONTEUDO/regra de negocio dos 3 e-mails ja existentes (so o mecanismo de envio + visual) — datas/valores/condicoes de disparo continuam as mesmas ja aprovadas nas SPECs 038/039/040.
- Configurar de fato o dominio/remetente verificado no Resend — responsabilidade do usuario fora do codigo (ver D-046-1).
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-27)

D-046-1: Remetente POR CENARIO (nao unico) — cada template tem seu proprio `from` verificado no Resend (ex.: cobranca@dominio para lembretes/assinatura, suporte@ ou no-reply@ para esqueci-senha/boas-vindas de cortesia). Configuracao exata de qual e-mail por cenario cabe ao dev-backend propor (`RESEND_FROM_*` por cenario ou um mapa de remetentes), documentando no relatorio — o usuario configura os enderecos reais/verificados no Resend depois, fora do codigo.

D-046-2: Fallback SMTP tambem em ERRO/TIMEOUT do Resend (nao so quando a chave esta ausente) — maximiza a chance do e-mail sair. Implementar com cuidado pra nao duplicar envio (ex.: se o Resend retornar erro DEPOIS de aceitar a requisicao mas antes de confirmar entrega, decidir por timeout curto + fallback, documentando a janela de corrida aceita).

D-046-3: E-mail de "assinatura efetuada com sucesso" dispara em TODA transicao pra `active`/`trialing` com sucesso, incluindo troca de plano (nao so o checkout inicial) — ajustar o gatilho em `processBillingEvent` de acordo.

## Riscos
- Resend e um servico de terceiro novo no projeto — se a chave for invalida/o servico cair, o fallback SMTP (D-046-2) e a rede de seguranca; testar esse caminho e obrigatorio, nao so o caminho feliz do Resend.
- HTML de e-mail tem compatibilidade inconsistente entre clientes (Gmail/Outlook/Apple Mail renderizam CSS de formas diferentes) — usar HTML+CSS inline simples (sem flexbox/grid, tabelas se necessario) reduz esse risco; o `text` (fallback multipart) garante legibilidade minima em qualquer cliente.

## Ordem de execucao
Backend (dev-backend), unica frente (sem UI nova), depois QA. Aprovada, decisoes fechadas — pode implementar direto.

## Implementation Notes (dev-backend, 2026-09-27)

### Arquivos criados
- `src/lib/channels/email/provider.ts` — interface `EmailProvider` + `getEmailProvider`/`resendConfigured` (factory por env, mesmo padrao de `src/lib/billing/provider-factory.ts`, D-33-5).
- `src/lib/channels/email/providers/smtp.ts` — `SmtpEmailProvider`, extraido de `system-mail.ts` (SPEC-038) SEM alterar a checagem anti-SSRF (`resolvePublicHost`) nem a config `SMTP_HOST/PORT/USER/PASS`.
- `src/lib/channels/email/providers/resend.ts` — `ResendEmailProvider` (SDK oficial `resend`, instalado via `npm install resend --legacy-peer-deps`). Lanca `AppError` crua; quem decide fallback/timeout e normaliza e sempre `system-mail.ts`.
- `src/lib/channels/email/scenario.ts` — `EmailScenario` + `fromAddressForScenario` (D-046-1, ver esquema de remetente abaixo).
- `src/lib/channels/email/templates/layout.ts` — layout HTML compartilhado (header "LeadForge" + `#6d5ef5`, tabelas, max-width 600px, sem MJML/react-email) + `escapeHtml`/`renderButton`.
- `src/lib/channels/email/templates/format.ts` — `formatCentsBRL`/`formatDateBR` (`timeZone: "UTC"` fixo — datas armazenadas sao instantes UTC).
- `src/lib/channels/email/templates/password-reset.ts`, `courtesy-welcome.ts`, `billing-reminder.ts` (4 variantes internas), `subscription-success.ts` (NOVO), `subscription-canceled.ts` (NOVO) — cada um gera `{subject, html, text}`.
- Testes: `src/lib/channels/system-mail.test.ts` (reescrito p/ nova assinatura + fallback D-046-2), `src/lib/channels/email/provider.test.ts`, `src/lib/channels/email/scenario.test.ts`, `src/lib/channels/email/providers/resend.test.ts`, `src/lib/channels/email/templates/templates.test.ts`, `src/lib/billing/process-event-email.test.ts` (cenarios novos, mock de `sendSystemEmail`, NUNCA chama Resend/SMTP real).

### Arquivos alterados
- `src/lib/channels/system-mail.ts` — `sendSystemEmail` vira orquestrador: assinatura passou a `(to, subject, content: {html,text}, scenario: EmailScenario, opts?)`; escolhe o provider primario (Resend se `RESEND_API_KEY`, senao SMTP) e cai automaticamente no fallback SMTP em QUALQUER erro/timeout do Resend (D-046-2, timeout default 8s, override via `opts.resendTimeoutMs`). Continua sendo a UNICA funcao publica consumida pelos 5 callsites; nunca lanca.
- `src/lib/actions/auth.ts` (esqueci-senha) e `src/lib/actions/admin/organizations.ts` (boas-vindas de cortesia) — passam a montar `{subject, html, text}` via `passwordResetTemplate`/`courtesyWelcomeTemplate` e chamam `sendSystemEmail(..., "password_reset"/"courtesy_welcome")`. Conteudo textual preservado 1:1 (SPEC-038/040), so mudou mecanismo/visual.
- `src/lib/billing/reminders.ts` — `notifyOwners`/`remind` passam a usar `billingReminderTemplate(kind)` (os 4 subtypes da SPEC-039, texto preservado 1:1) e `scenario: "billing_reminder"`.
- `src/lib/billing/process-event.ts` — `processBillingEvent` retorna o `canceledAt` computado dentro da transacao (para uso pos-commit) e, apos "processed", dispara best-effort (try/catch dedicado, nunca propaga) o e-mail de "assinatura efetuada" (`event.status` `active`/`trialing`) ou "assinatura cancelada" (`event.status === "canceled"`, com `purgeDate = canceledAt + CANCEL_RETENTION_MS`, D-33-4) para todo `Membership.orgRole === "owner"` da org.
- `src/lib/env.ts` e `.env.example` — `RESEND_API_KEY`, `RESEND_FROM_NOREPLY`, `RESEND_FROM_SUPPORT`, `RESEND_FROM_BILLING`, `RESEND_FROM_EMAIL` (todos opcionais/comentados; ausencia = fallback SMTP automatico, nada quebra).
- `src/lib/auth/auth.test.ts` — 2 asserts atualizados para a nova forma do 3º argumento (`content.text` em vez de `body` string).
- `package.json`/`package-lock.json` — dependencia `resend` adicionada (`npm install resend --legacy-peer-deps`).

### Correcao de local (nao de decisao) em relacao ao texto original da SPEC
O texto do escopo (item 6/secao "Cenario novo 2") apontava `status-map.ts` (`syncOrgStatuses`) como o lugar que grava `canceledAt`/transiciona pra `canceled`. Na base de codigo real, quem grava `Subscription.canceledAt` e decide a transicao e SEMPRE `process-event.ts` (`processBillingEvent`) — `status-map.ts` so LE `Subscription.status` pra recalcular `Organization.status`/`suspendedReason`, nunca escreve em `Subscription`. O gatilho de negocio exigido pela SPEC (disparar exatamente quando `canceledAt` e gravado/a assinatura transiciona pra `canceled`) foi implementado sem alteracao nenhuma — só no arquivo correto (`process-event.ts`, mesmo lugar onde o cenario 1 "assinatura efetuada" ja roda, por simetria e por ja ter acesso a `canceledAt`/`Membership`). Nenhuma regra de negocio, campo ou condicao de disparo foi alterada; reportando aqui por transparencia (regra 13, correcao de local != mudanca de decisao).

### D-046-1 — esquema de remetente escolhido
3 envs agrupando por "voz" do remetente (mais simples de configurar que 5 envs individuais, mantendo a separacao por cenario exigida pela decisao):
- `RESEND_FROM_NOREPLY` → `password_reset`.
- `RESEND_FROM_SUPPORT` → `courtesy_welcome`.
- `RESEND_FROM_BILLING` → `billing_reminder`, `subscription_success`, `subscription_canceled` (mesma "voz" de cobranca/assinatura).

Fallback em cascata (nunca erro fatal por remetente ausente): env do cenario → `RESEND_FROM_EMAIL` (generico) → `SMTP_USER` → `"no-reply@leadforge.local"`. Implementado em `src/lib/channels/email/scenario.ts` (`fromAddressForScenario`).

### D-046-2 — fallback SMTP em erro/timeout do Resend
`sendSystemEmail` tenta o Resend primeiro (quando `RESEND_API_KEY` setada) com timeout de 8s (`withTimeout`, `Promise.race` interno); QUALQUER excecao (erro de rede, erro reportado pela API, timeout) cai automaticamente no `SmtpEmailProvider` de fallback antes de retornar `{ok:false}`. Janela de corrida ACEITA e documentada no codigo (`system-mail.ts`, JSDoc de `resendTimeoutMs`): se o Resend aceitar a requisicao mas so confirmar a entrega DEPOIS do timeout, o fallback tenta enviar mesmo assim — risco baixo e aceito de e-mail duplicado nesse cenario raro, preferido a arriscar nunca entregar.

### D-046-3 — gatilho de "assinatura efetuada"
Interpretado literalmente conforme a decisao fechada: dispara em TODA transicao bem-sucedida (`processBillingEvent` retorna `"processed"`, nao `"duplicate"`) para `event.status === "active"` ou `"trialing"` — cobre checkout inicial, troca de plano e qualquer evento subsequente que resulte em active/trialing (inclusive `payment.recovered`, por ser tambem uma transicao bem-sucedida para `active`). Testado explicitamente em `process-event-email.test.ts` (checkout inicial, trialing, troca de plano, idempotencia via `eventId` duplicado nao reenvia).

### Testes executados (VERIFIED)
Rodados com `npx tsc --noEmit`, `npm run lint` e `npx vitest run <arquivo>`/`npm test` (aguardado processo `vitest` concorrente de outro agente terminar antes do `npm test` completo, confirmado via `ps aux`):
- `npx tsc --noEmit` — sem erros novos (erros pre-existentes em `pix-renewal.ts`/`integrations/view.ts`/`mobile/*.test.ts` sao de outras SPECs em paralelo, fora de escopo).
- `npm run lint` — 0 erros (5 warnings pre-existentes, nenhum em arquivo tocado por esta SPEC).
- `npm test` (suite completa, 121 arquivos) — 1468 passed, 4 failed. As 4 falhas sao PRE-EXISTENTES/de outras SPECs em paralelo, nao relacionadas a esta implementacao: `src/lib/mobile/alerts.test.ts`/`metrics.test.ts` (ajv strict-mode `"components"` + 1 assert de `sweepAlerts`, fora de `../mobile/`-equivalente web, arquivos que esta SPEC nunca tocou) e `src/lib/whatsapp/provider.test.ts` (guarda de import aponta `src/lib/billing/providers/abacatepay.test.ts`, artefato do SPEC-047/AbacatePay rodando em paralelo). Confirmado por leitura dos stacktraces: nenhuma falha referencia `channels/email`, `system-mail`, `process-event`, `reminders`, `status-map`, `auth.ts`(actions) ou `organizations.ts`(admin).
- Todos os arquivos criados/alterados por esta SPEC passam 100%: `system-mail.test.ts` (16), `email/provider.test.ts` (7), `email/scenario.test.ts` (6), `email/providers/resend.test.ts` (4), `email/templates/templates.test.ts` (12), `billing/process-event-email.test.ts` (9), `billing/process-event.test.ts` (11, pre-existente, continua passando), `billing/reminders.test.ts` (16, pre-existente, continua passando), `auth/auth.test.ts` (atualizado, continua passando), `actions/admin/organizations.test.ts` (pre-existente, continua passando).

### Criterios de aceitacao

| Criterio | Status | Evidencia |
|---|---|---|
| `EmailProvider` interface + factory por env (Resend se `RESEND_API_KEY`, senao SMTP) | PASS | `email/provider.ts`, `email/provider.test.ts` |
| Adapter SMTP preserva anti-SSRF/`normalizeSmtpError` | PASS | `email/providers/smtp.ts` (extraido sem alterar logica), `system-mail.test.ts` (testes de SSRF/erro normalizado ainda passam) |
| `sendSystemEmail` continua unica funcao publica dos 5 callsites | PASS | `auth.ts`, `organizations.ts`, `reminders.ts`, `process-event.ts` (x2) — todos so importam `sendSystemEmail` |
| Fallback SMTP tambem em erro/timeout do Resend (D-046-2) | PASS | `system-mail.test.ts` ("Resend lanca erro"/"Resend expira (timeout)") |
| 5 templates HTML+text, layout SPEC-037 | PASS | `templates/*.ts`, `templates.test.ts` |
| Remetente por cenario (D-046-1) | PASS | `email/scenario.ts`, `scenario.test.ts` |
| Cenario novo "assinatura efetuada" (D-046-3, inclui troca de plano) | PASS | `process-event.ts`, `process-event-email.test.ts` |
| Cenario novo "assinatura cancelada" (com data de expurgo 90d) | PASS | `process-event.ts`, `process-event-email.test.ts` |
| `.env.example` com vars opcionais/comentadas | PASS | `.env.example` (secao Resend) |
| E-mail nunca trava o fluxo que disparou (best-effort, mesmo com falha total de ambos os providers) | PASS | `system-mail.test.ts` ("Resend E o fallback SMTP falham"), `process-event-email.test.ts` ("falha total do envio... NAO lanca") |
| Testes nunca chamam Resend/SMTP real | PASS | todos os providers sao injetados/fake nos testes (`client`/`primaryProvider`/`fallbackProvider`/`transport`) |

### Limitacoes conhecidas
- Remetente por cenario (D-046-1) so tem efeito pratico no Resend (exige dominio verificado); no fallback SMTP o header `From` e setado mas a maioria dos servidores SMTP so aceita a conta autenticada mesmo — documentado no `.env.example`.
- Nenhuma UI nova (fora de escopo da SPEC); nenhuma alteracao em `../mobile/`.
- `D-046-3` interpretado literalmente (qualquer transicao bem-sucedida para active/trialing, incluindo `payment.recovered`) — se o usuario quiser excluir `payment.recovered` do gatilho de "assinatura efetuada" no futuro, e mudanca de escopo/nova decisao, nao implementada aqui.

### QA (2026-09-27) — QA APPROVED
Reverificado na sessao de 2026-09-27: factory `getEmailProvider` escolhe Resend somente com `RESEND_API_KEY` setada (sem chave → SMTP direto, nenhuma tentativa de Resend); adapter SMTP preserva `resolvePublicHost`/anti-SSRF (SPEC-010) e `normalizeSmtpError` continua centralizado em `system-mail.ts`; os 5 callsites de producao (`auth.ts`, `organizations.ts`, `reminders.ts`, `process-event.ts`) importam apenas `sendSystemEmail` (nenhum import direto de `providers/resend.ts`/`smtp.ts`); 5 templates + layout SPEC-037; cenarios novos `subscription_success`/`subscription_canceled` disparados em `process-event.ts` em best-effort (falha total nao lanca, `notifyOwners` engole o erro); `.env.example` documenta as vars. `npm test` → 123 arquivos / 1489 testes verdes (inclui `system-mail.test.ts`, `provider.test.ts`, `templates.test.ts`, `scenario.test.ts`, `process-event-email.test.ts`); `tsc`/`eslint`/`next build` OK.
