# SPEC-064 — Senha do cadastro: mínimo 6, confirmar senha e indicador de força
- status: **APPROVED (usuario, 2026-10-12, pedido direto)** -> **IMPLEMENTED (2026-10-12, sem commit; aguarda QA em navegador)** | domain: fullstack | depende de: 033/034 (signup), 038/042 (redefinir senha), 049/062 (convite)
- Pedido do usuário: "arrumar no cadastro do usuário para a senha ter pelo menos 6 caracteres, ter o campo de confirmar senha e uma experiência visual da força da senha".

## Decisões
- **D-064-1** Regra única de senha NOVA em `src/lib/schemas/password.ts`: mínimo 6, máximo 256, mensagem "Senha deve ter ao menos 6 caracteres." Vale para `signupSchema` (billing), `signupJoinSchema`/`inviteSignupFormSchema` (org) e `resetPasswordSchema` (auth). Fora: `ADMIN_PASSWORD` (env, 12), chave de integração, senhas de caixa de e-mail, login (**sem mínimo novo**; contas com 12+ seguem entrando).
- **D-064-2** `confirmPassword` obrigatório nos 3 formulários e nos 3 schemas de servidor (`refine`: "As senhas não coincidem.", erro em `confirmPassword`). A action valida; o campo nunca é persistido nem logado. Quebra proposital do contrato das actions: chamadas sem `confirmPassword` falham.
- **D-064-3** `autoComplete="new-password"` e `PasswordInput` (botão mostrar/ocultar por campo) nos dois campos.
- **D-064-4** Indicador de força: helper puro `scorePassword(password, personal[])` em `src/lib/password-strength.ts` + `PasswordStrength` (barra de 4 segmentos, texto "Muito fraca/Fraca/Razoável/Forte", `aria-live="polite"`, cores com variante dark). 100% local, sem biblioteca nem rede. Critérios: comprimento (6/8/12+), classes de caracteres, penaliza senhas comuns (inclui comum + 1-3 dígitos), sequências/repetições e igual/derivada de nome ou e-mail. É só orientação.
- **D-064-5** A força NÃO bloqueia o envio acima de 6 (decisão do usuário); "Muito fraca" mostra aviso e dica.

## Critérios de aceitação
- AC-1 6 caracteres passa; 5 falha (cliente e servidor) com a mensagem única. AC-2 confirmação diferente/ausente falha em `confirmPassword` no cliente e no servidor (signUp, signUpAndJoin, resetPassword). AC-3 dicas dos formulários dizem "Mínimo de 6 caracteres." AC-4 login sem mínimo. AC-5 `scorePassword` classifica comuns/sequências/pessoal como muito fraca e frases longas variadas como forte. AC-6 componente com texto + `aria-live`. AC-7 testes e tsc verdes; 390px/teclado/dark validados em navegador (bloco S do ROTEIRO).

## Implementation Notes
- **Política alterada (12 -> 6) por decisão do usuário.** Risco aceito: senha curta é mais fácil de adivinhar. Mitigações: indicador de força com aviso; rate limit de login existente (SPEC-059).
- Arquivos: `src/lib/schemas/{password,billing,org,auth}.ts`, `src/lib/password-strength.ts`, `src/components/auth/{PasswordStrength,SignupForm,ResetPasswordForm}.tsx`, `src/components/org/InviteLanding.tsx`; testes `password.test.ts`, `password-strength.test.ts`, `password-ui.test.tsx` e ajustes em `auth.test.ts`, `billing.test.ts`, `org*.test.ts`, `email-verification.test.ts`, `org-format.test.ts`; docs PRIMEIROS_PASSOS, ROTEIRO (bloco S), RETOMAR.
- `ResetPasswordForm` deixou de ter schema cliente próprio (usa `resetPasswordSchema`, que agora tem a confirmação).
- Limitação: o hint de "Muito fraca" é estático (cita exemplos), a lista de senhas comuns é pequena (heurística, não zxcvbn).
