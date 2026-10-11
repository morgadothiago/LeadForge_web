# SPEC-055 — E-mails de cadastro, verificacao de e-mail e seguranca da conta
- status: IMPLEMENTED (055a backend e 055b frontend implementados 2026-10-10) | domain: fullstack (## Backend, ## Frontend) | depende de: 038, 046, 048, 052 (`sendOnce`) | catalogo: #1 (P0), #2 (P1), #15 (P1); #16 login em dispositivo novo (P2) so registrado como futuro

## Objetivo
Enviar boas-vindas ao usuario que se cadastra sozinho, verificar o e-mail (token uso unico) e avisar sobre alteracoes de seguranca (senha/e-mail alterados) - incluindo o endereco antigo.

## Contexto (lido no repo)
- Signup: `signUpAndStartCheckout` (`src/lib/actions/billing.ts:88-137`) cria User+Org+Membership+Subscription e `createSession` sem enviar e-mail; `signUpAndJoin` (`org.ts:451`) idem; `createOrganization` (`org.ts:125`) cria org extra (nao deve gerar boas-vindas de conta). So existe `courtesy_welcome` (`courtesy-welcome.ts`, SPEC-040, conta criada pelo admin, remetente support).
- Nao existe `emailVerified`/`emailVerifiedAt` em `User` (`schema.prisma:195-219`). Nao ha fluxo de verificacao; checkout self-service e login funcionam sem verificar.
- Reset de senha (SPEC-038): `forgotPassword` (`auth.ts:86`) anti-enumeracao + `resetPassword` (`auth.ts:123`) invalida sessoes via `sessionsInvalidatedAt` (`require-user.ts:29-53`), token em hash/expira 24h (D-038-1, `PasswordResetToken`). `resetPassword` NAO envia e-mail de "senha alterada".
- Nao existe tela/acao de alterar senha, e-mail ou perfil logado (grep `changePassword|updateProfile|changeEmail` em `src/` sem resultados; configuracoes tem agentes/assinatura/email/equipe/integracoes/supressao/whatsapp). Logo #15 para "e-mail alterado" depende de CRIAR a funcionalidade (Q-055-4); "senha alterada" cobre ao menos o reset existente.
- Login e login mobile (`auth.ts:34`, `src/app/api/mobile/v1/auth/login/route.ts`) nao registram dispositivo/IP conhecido para #16.
- Rate limit de signup por IP (`signupLimiter`, `billing.ts:~92`); anti-enumeracao: duplicate email retorna mensagem generica (`billing.ts:~118-125`) - o e-mail de boas-vindas NUNCA deve ser enviado/omitido de forma que revele conta existente.

## Escopo proposto
## Backend
1. Boas-vindas (#1, support): disparado APOS commit do signup (e `signUpAndJoin`), best-effort, idempotente `welcome:<userId>` via `sendOnce`; nao em `createOrganization`. Conteudo: proximos passos, link do app, suporte, data do fim do trial (coordenar com SPEC-052 item 5, Q-052-6).
2. Verificacao de e-mail (#2, noreply): colunas aditivas `User.emailVerifiedAt DateTime?`; `EmailVerificationToken { userId, email, tokenHash @unique, expiresAt, usedAt }` (padrao `PasswordResetToken`); acao de reenvio com rate limit + cooldown; rota de confirmacao; usuarios EXISTENTES: backfill (marcar como verificados? Q-055-2). Efeito do nao-verificado: Q-055-1 (D5 do doc).
3. Seguranca (#15, noreply): e-mail "senha alterada" no `resetPassword` (e em eventual troca de senha logado) para o proprio endereco, com orientacao "nao foi voce"; e-mail "e-mail alterado" para o endereco ANTIGO (e confirmacao ao novo) - so se a troca de e-mail for criada (Q-055-4). Sem dado sensivel, sem link que de acesso direto.
4. Cenarios novos: `welcome`, `email_verification`, `password_changed`, `email_changed` em `EmailScenario` e nas tabelas Resend/ACS (support/noreply).
5. Testes: boas-vindas uma vez por usuario (retry/duplo submit); nenhum e-mail em signup com e-mail ja existente (anti-enumeracao); token de verificacao uso unico/expira/reuso/hash; reenvio com rate limit; "senha alterada" no reset; falha do provider nao quebra signup/reset; snapshots de template.
## Frontend
6. Banner/estado "verifique seu e-mail" + botao reenviar + pagina de confirmacao (conforme Q-055-1); RHF+zod; a11y. Tela de alterar senha/e-mail apenas se Q-055-4 = criar.

## Fora do escopo
- #16 login em dispositivo desconhecido (P2: exige modelo de dispositivo/IP/geolocalizacao); MFA; e-mails de marketing/produto e preferencias de descadastro (exigem base legal e opt-out - SPEC propria); social login.

## Criterios de aceitacao
- Signup novo envia 1 boas-vindas; e-mail ja cadastrado nao envia nada e responde igual a antes; reenvios/duplo clique nao duplicam.
- Verificacao conforme decisao Q-055-1; token so hash, uso unico, expiracao curta.
- Reset de senha envia aviso "senha alterada" ao proprio usuario; nenhum e-mail revela existencia de conta.
- `tsc`, lint, vitest verdes; migration aditiva a mao.

## Seguranca / riscos
- Enumeracao de contas por diferenca de e-mail/tempo de resposta; token em log; spam de reenvio (rate limit por usuario+IP). Bloquear acesso de usuarios existentes por falta de verificacao e risco de churn (backfill). Mudanca de e-mail e fluxo sensivel (confirmacao dupla).

## Decisoes pendentes
- Q-055-1 (D5 do doc): verificacao de e-mail bloqueia o uso do app, so o checkout/pagamento, ou apenas avisa? (Recomendacao a validar pelo usuario: bloquear so checkout/convites/envios de campanha.)
- Q-055-2: usuarios ja existentes: marcar como verificados via backfill ou exigir verificacao?
- Q-055-3: boas-vindas e "inicio do trial" (SPEC-052) em um e-mail so?
- Q-055-4: criar tela/acao de alterar senha e e-mail do perfil nesta SPEC (hoje nao existem) ou so cobrir o reset?
- Q-055-5: idioma unico pt-BR ou preparar i18n (en) nos templates agora? (hoje tudo pt-BR; recomendacao: so pt-BR)
- Q-055-6: usuarios convidados via `signUpAndJoin` com token de convite: o clique no convite conta como e-mail verificado?

## Decisoes registradas (2026-10-10, usuario aprovou com as recomendacoes do RETOMAR secao 3 item 4)
- D-055-1 (Q-055-1, CONFIRMED): verificacao de e-mail e obrigatoria para ENVIAR mensagens (campanhas/sequencias), NAO para entrar no app.
- D-055-2 (Q-055-3/Q-052-6, CONFIRMED): `trial-started` separado das boas-vindas.
- Demais questoes decididas em 2026-10-10 por defaults conservadores (INFERRED, revisaveis):
- D-055-3 (Q-055-2, INFERRED): backfill - usuarios EXISTENTES sao marcados como verificados na migration (evita churn/bloqueio); so cadastros novos precisam verificar.
- D-055-4 (Q-055-4, INFERRED): NAO criar tela de alterar senha/e-mail nesta SPEC (fica para SPEC futura); cobre so o aviso "senha alterada" no reset. O cenario `email_changed` NAO e criado agora.
- D-055-5 (Q-055-5, INFERRED): somente pt-BR.
- D-055-6 (Q-055-6, INFERRED): `signUpAndJoin` por convite conta como verificado SOMENTE se o e-mail do cadastro for exatamente o e-mail convidado e o token for valido (o convite prova posse da caixa); entrada por codigo (`joinCode`) NAO verifica.
- D-055-7 (Q-055-1 detalhe, INFERRED): o bloqueio de nao-verificado vale para enviar mensagens (campanhas/sequencias/envios do scheduler e envio manual); login, checkout e demais telas seguem liberados; aviso/banner com reenvio.
- D-055-8 (INFERRED): token de verificacao expira em 24h, uso unico, so hash; reenvio com cooldown de 60s e rate limit por usuario e IP.
- Decisoes transversais: (c) recibo = so e-mail informativo; (d) regua de cartao e PIX igual.

## Implementation Notes — 055a (backend, 2026-10-10)
- Escopo entregue: itens 1-5 da secao Backend. Frontend (item 6) fica para a 055b. Nao ha commit.
- Arquivos: `prisma/schema.prisma` (+`User.emailVerifiedAt DateTime? @default(now())`, +model `EmailVerificationToken`; `prisma format` realinhou colunas), `prisma/migrations/20261015120000_email_verification/migration.sql` (a mao, aditiva, com backfill), `src/lib/auth/email-verification.ts` (token/hash/TTL/limiters/`issueVerificationEmail`/`sendWelcomeEmail`/`sendSignupEmails`/`assertUserEmailVerified`), `src/lib/actions/auth.ts` (+`verifyEmail`, +`resendVerificationEmail`, aviso em `resetPassword`), `billing.ts` (`signUpAndStartCheckout`), `org.ts` (`signUpAndJoin`), `src/lib/auth/require-user.ts` (+`emailVerified`), `src/lib/channels/reserve.ts` (`deferUnverifiedBeforeReserve`), `email.ts`, `whatsapp.ts`, `src/lib/agents/drafts.ts`, `src/lib/scheduler/run-tick.ts` (ajuste de tipo), `src/lib/errors.ts` (+`email_not_verified`), `src/lib/actions/result.ts`, `scenario.ts` (+welcome/email_verification/password_changed, Resend e ACS), templates `welcome.ts`/`email-verification.ts`/`password-changed.ts`, testes `email-verification.test.ts` (novo, 29) e `use-server-auth.test.ts` (allowlist +`verifyEmail`).
- Decisoes de implementacao (dentro das D-055-*): (1) `emailVerifiedAt` tem DEFAULT now(): usuarios existentes (backfill na migration), criados pelo admin, seed e fixtures de teste nascem verificados; so o cadastro self-service (e `signUpAndJoin` por codigo) grava `null` explicitamente. (2) Gate D-055-7 no ponto de estrangulamento unico `deferUnverifiedBeforeReserve` (chamado por `sendEmail`/`sendWhatsApp`, por onde passam scheduler, agentes e retry manual): usa o dono da campanha (`campaign.userId`); nao reserva o Touch, devolve `deferred` com `reason: "email_not_verified"` (retentativa em 1h; nada e perdido nem queima sequencia/tentativas). Aprovacao MANUAL de rascunho (`dispatchDraft` com `reviewer`) lanca `AppError` `email_not_verified` antes de consumir o rascunho; a action devolve `{ok:false, errors:{_form:[msg], code:["email_not_verified"]}}`. (3) `password_changed` idempotente por id do token de reset; `welcome` por `welcome:<userId>`. (4) E-mail de verificacao nao usa `sendOnce` (reenvios legitimos geram token novo); cooldown 60s via ultimo token no banco + limiters em memoria 5/h por usuario e 20/h por IP. (5) Link do e-mail aponta para `/verificar-email?token=...` (pagina a criar na 055b; chamar `verifyEmail`).
- Contrato para a UI: `requireUser()` -> `CurrentUser.emailVerified: boolean` (banner quando false). `verifyEmail(token | {token})` -> `ok {verified:true}` ou `_form` generico (publica, sem sessao). `resendVerificationEmail()` -> `ok {sent, alreadyVerified}`; erro com `errors.code[0]` = `"cooldown"` | `"rate_limited"` e `errors.retryAfterSeconds[0]`. Erros de envio: `errors.code[0] === "email_not_verified"`. `/verificar-email` precisa ser rota publica no `proxy.ts` na 055b.
- Testes (banco `leadforge_055_test`): tsc limpo; eslint 0 erros (20 warnings preexistentes); vitest completo 157 arquivos / 1983 testes verdes (VERIFIED).
- Criterios: signup novo = 1 welcome (PASS); e-mail duplicado sem e-mail e mesma resposta (PASS); duplo disparo nao duplica (PASS); token so hash/uso unico/expira/reuso/concorrencia (PASS); reenvio com cooldown e rate limit usuario+IP (PASS); aviso de senha alterada e falha de provider nao quebra reset/signup (PASS); gate de envio e dispatchDraft (PASS); convite com e-mail identico verifica, codigo nao (PASS).
- Limitacoes: limiters em memoria por processo (padrao do repo); migration NAO aplicada no banco de dev `leadforge` (so no de teste). `email_changed` nao criado (D-055-4). Gate usa o dono da campanha, nao o ator que aprova.

## Implementation Notes — 055b (frontend, 2026-10-10)
- Escopo entregue (item 6): pagina publica `/verificar-email?token=...`, banner no layout logado e mensagem clara de `email_not_verified` no envio. Sem formulario novo (so botoes), logo sem RHF/zod. Sem commit.
- Arquivos: `src/app/verificar-email/page.tsx`, `src/components/auth/VerifyEmailResult.tsx` (chama `verifyEmail` uma vez ao abrir, guard por ref contra duplo efeito do StrictMode; sucesso -> "Ir para o app", erro -> "Ir para o login"; sem token nao chama a action), `src/components/auth/VerifyEmailBanner.tsx` (sem botao de fechar; `Reenviar e-mail` com loading, contagem regressiva por `retryAfterSeconds` em cooldown/rate_limited, `alreadyVerified`, `role=status`/`alert`), `src/components/auth/email-verification-ui.ts` (helpers puros), `src/app/(app)/layout.tsx` (banner quando `!user.emailVerified`), `src/proxy.ts` (+`/verificar-email` publica), `src/components/agents/DraftQueue.tsx` (toast com `EMAIL_NOT_VERIFIED_MESSAGE` quando `errors.code[0]==="email_not_verified"` em aprovar rascunho), testes `src/components/auth/email-verification-ui.test.tsx` (novo, 6) e `src/proxy.test.ts` (+1).
- Testes: tsc limpo; eslint 0 erros (20 warnings preexistentes); vitest completo 158 arquivos / 1989 testes verdes com `leadforge_055_test` (VERIFIED).
- Criterios: link de confirmacao funciona sem sessao (PASS); banner so para nao verificado, sem fechar, reenvio com cooldown/limite (PASS); mensagem de envio bloqueado (PASS).
- Limitacoes: aprovacao em lote (`bulkApproveFollowups`) engole o erro do backend e conta como `blocked` (nao mostra a mensagem especifica; backend, nao alterado). Nao ha UI de retry manual de envio fora de DraftQueue. Nao validado em navegador real (so SSR). Migration ainda nao aplicada no banco de dev.
