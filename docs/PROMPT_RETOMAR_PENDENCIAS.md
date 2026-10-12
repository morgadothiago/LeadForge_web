# Prompt: retomar o LeadForge vendo TUDO que ficou pendente

Cole no início de qualquer sessão nova do Claude Code, na pasta `LeadForge_web`. Atualizado em 2026-10-12.
O `CLAUDE.md` já manda ler o `docs/RETOMAR.md`; este prompt vai além: **confere o estado real** (git, PRs, SPECs, produção) e
monta a lista de pendências antes de qualquer trabalho, para nada ficar esquecido.

---

## Prompt

Retome o projeto LeadForge (`/Users/thiagomorgado/Desktop/LeadForge_web`). Responda em pt-BR, direto, sem enrolação.
**Não escreva nem altere código, não faça deploy, não grave segredos e não mexa na Vercel/AbacatePay até eu escolher o que fazer.**
Esta etapa é só levantar o estado e me mostrar tudo que está pendente.

### 1. Leia, nesta ordem
1. `docs/RETOMAR.md`, **seção 0** (manda; as seções 1 a 8 são histórico e podem estar desatualizadas).
2. `specs/README.md` (índice e status das SPECs) e `AGENTS.md` (este Next.js tem breaking changes).
3. As memórias do projeto, se houver (`~/.claude/projects/-Users-thiagomorgado-Desktop-LeadForge-web/memory/MEMORY.md`).

### 2. Confira o estado REAL (não confie só no texto do RETOMAR)
Rode e resuma (sem imprimir valores de segredos, `.env` nem chaves):
- `git status --short`, `git branch -vv`, `git log --oneline -10`, e compare `main` local com `origin/main` (`git fetch` antes).
- `gh pr list --state open` e `gh run list --limit 5`.
- SPECs que **não** estão `IMPLEMENTED`: `grep -E "^\| 0[0-9][0-9]" specs/README.md | grep -v IMPLEMENTED`
  (hoje esperadas: **065 DRAFT**; 063b pendente; 021-023 fora do escopo).
- Produção: `curl -s -o /dev/null -w "%{http_code}" https://lead-forge-web-omega.vercel.app/login`, o último deploy
  (`vercel ls | head`), e se o log recente tem erro de e-mail (`vercel logs lead-forge-web-omega.vercel.app --since 1h | grep -iE "EAUTH|send-once|email-verification"`).
- Ambiente local (só leitura): `docker ps`, `lsof -nP -iTCP:3000 -sTCP:LISTEN`, `pgrep -fl cloudflared` (o túnel costuma estar desligado).
- Se o `RETOMAR.md` estiver desatualizado em relação ao git, **avise e proponha a correção** (sem aplicar ainda).

### 3. Monte a lista de pendências, agrupada
Apresente em tabelas curtas, com o que **bloqueia** o quê:

| Grupo | O que listar |
|---|---|
| **Depende de mim (decisão/conta/DNS)** | e-mail real em produção (Resend + DNS no HostGator, ou SMTP), webhook de produção no AbacatePay, `APROVAR SPEC-065` e as perguntas abertas dela, preços e limites dos planos (PLACEHOLDER), parecer jurídico da retenção, termos de uso e política de privacidade, Q-062-2 (trials reais no Neon), conferir `AUTH_URL` na Vercel |
| **Código a fazer (fila)** | SPEC-065 (Free de 7 dias, depois de aprovada), toasts e erro do backend no front, admin (sino de eventos + sidebar; prompt em `docs/PROMPT_ADMIN_NOTIFICACOES_SIDEBAR.md`), SPEC-063b (cancelar/reativar/trocar plano no AbacatePay, HMAC, reconciliação, 2 achados médios do QA), correção do `buildCommand` (risco D3: todo push de branch gera Preview que roda `migrate deploy` e o seed no **mesmo banco da produção**) |
| **Riscos ativos** | produção usa a chave **DEV** do AbacatePay; preços placeholder visíveis; Preview migra o banco de produção; sem e-mail real ninguém verifica nem paga na Vercel; cabeçalhos de segurança ausentes; `npm audit` (Next com advisory crítico, correção em 16.4.0); landing promete o que só tem mock; limites de plano não aplicados |
| **Validação manual que só eu faço** | bloco O/P/S do `docs/ROTEIRO_DE_TESTES.md` (formulários, fluxo novo, senha), pagamento completo com o cartão `4242 4242 4242 4242` no dev mode, dark mode/teclado/leitor de tela |
| **Higiene** | arquivos fora do git que devem ficar fora (`next.config.ts` local com `allowedDevOrigins`, `.claude/`, `skills-lock.json`), segredos em `~/.leadforge-secrets/`, bancos `*_test` sobrando no Postgres local |

Para cada item diga: **quem faz** (eu ou o Claude), **tempo estimado** e **o que destrava**.

### 4. Termine assim (e pare)
1. Resuma em até 8 linhas: onde paramos e o estado da produção.
2. Diga se algo do `RETOMAR` está desatualizado.
3. Recomende **a próxima ação** (uma só) e o porquê, com 2 alternativas.
4. Pergunte qual eu quero seguir. **Não comece sem minha resposta.**

### Regras do projeto (valem depois que eu escolher)
- Spec-Driven Development: SPEC `APPROVED` antes de código; uma SPEC por vez; QA independente (`qa-reviewer`) antes de commitar.
- Só commitar com `tsc`, lint (0 erros) e vitest verdes em banco `*_test` NOVO; nunca `prisma migrate dev` (só `migrate deploy`).
- Testes: rodar com `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test` no comando (o `.env` local aponta para o AbacatePay e um túnel).
- Cada merge na `main` **publica em produção** (Vercel ligada ao GitHub): confirme comigo antes de mergear mudança que afete o fluxo de cadastro/pagamento.
- Nunca colar nem imprimir segredos; usar os scripts (`~/save_abacate_key.sh`, `~/save_smtp_pass.sh`, `~/save_resend_key.sh`) e `pbcopy < arquivo`.
- Ao fechar trabalho: atualizar `docs/RETOMAR.md` (seção 0), `docs/ROTEIRO_DE_TESTES.md` e `docs/PRIMEIROS_PASSOS.md` (este em linguagem simples), commit e push.
