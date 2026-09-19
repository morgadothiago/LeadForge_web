# SPEC-009 — Autenticacao
- status: DRAFT | domain: fullstack | sessao: 2 (recomendo antecipar; ver D14) | ordem: 10 | depende de: SPEC-001, SPEC-003
## Contexto
PROMPT tem NEXTAUTH_SECRET/URL mas nenhum fluxo. Uso interno de agencia. `User.role` existe sem `passwordHash`.
## [NEEDS_DECISION D14] Estrategia
1. Auth.js (NextAuth v5) Credentials — padrao; vars AUTH_SECRET (v5) diferem das do PROMPT.
2. Sessao propria (cookie JWT com `jose` + bcrypt/argon2) — menos dependencia, mais codigo.
3. Sem auth (rede interna/VPN) — nao recomendado; webhooks e actions expostos.
Impacto: adiciona `passwordHash` ao User; protege todas as rotas (proxy/middleware do Next 16 — ler docs, nome pode ter mudado para `proxy`).
## Escopo (apos decisao)
Tela /login (PT-BR), logout, guarda de rotas `(app)`, `requireUser()` real substituindo o mock, seed de admin via env, rate limit basico de login. Webhooks (SPEC-012) ficam FORA da guarda e usam segredo proprio.
## Criterios de aceite
- [ ] Rota do app sem sessao redireciona para /login; com sessao acessa.
- [ ] Credenciais invalidas -> mensagem generica; senha hasheada no banco.
- [ ] `/api/webhooks/*` nao exigem sessao.
- [ ] Todas as Server Actions chamam `requireUser()` (grep/teste).
- [ ] build/lint/typecheck OK.
