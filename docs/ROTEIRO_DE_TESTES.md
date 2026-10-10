# Roteiro de testes manuais: admin da plataforma e tenants

Marque `[x]` ao passar. Anote o que falhar na coluna "Observado". Complementa o `docs/PRIMEIROS_PASSOS.md`.
Escrito em 2026-10-10. Rotas e usuários abaixo foram lidos do repo e do banco de dev; **os resultados esperados
são o que a SPEC prevê, não algo que eu tenha executado no navegador.**

## 0. Preparação (uma vez)

- [ ] **0.1** Infra no ar: `colima start` e `docker compose up -d postgres redis` (ver PRIMEIROS_PASSOS fase 1).
- [ ] **0.2** Aplicar as 2 migrations pendentes no banco de dev: `npx prisma migrate deploy`
  - Sem isso: convites, seletor de organização e arquivos falham (tabelas `OrgInvite`, `OrgAuditLog`, `StoredFile` não existem).
  - É aditivo e seguro. **Não use `migrate dev`** (proporia apagar colunas com dados; ver PRIMEIROS_PASSOS 1.3).
  - Verificar: `npx prisma migrate status` mostra só as 5 migrations `20260928*` como "não encontradas localmente" (drift
    antigo, esperado) e nenhuma pendente.
- [ ] **0.3** Reiniciar o `npm run dev` depois da migration (o Prisma Client novo é carregado na subida).
- [ ] **0.4** Cobrança: nada a fazer. `PAYMENT_PROVIDER` ausente = `mock` (checkout sem cartão).
- [ ] **0.5** E-mail sem enviar: Mailpit (`docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`),
  `ALLOW_PRIVATE_SMTP_HOSTS=true`, e conferir as mensagens em http://localhost:8025.
- [ ] **0.6** Use **janelas anônimas / navegadores diferentes** para duas sessões ao mesmo tempo (cookie é por navegador).

## Contas disponíveis no banco de dev (só e-mails e papéis)

| E-mail | Papel de plataforma | Organizações |
|---|---|---|
| `admin@leadforge.local` | `platform_admin` | "Admin" (owner), "Organização de Seed" (owner) |
| `platformadmin@leadforge.local` | `platform_admin` | nenhuma |
| `leonardo@coest.me` | `provider` | "1234567890@@" (owner) |
| `thiago@teste12.com` | `provider` | "teste" (owner) |
| `thiago@teste.com` | `provider` | "ThiagoMorgado123" (owner) |
| `thiago@teste.com.br` | `provider` | "teste teste teste 2" (owner) |

Senha do `admin@leadforge.local`: `ADMIN_PASSWORD` do seu `.env`. As senhas dos outros eu não conheço: **crie tenants
novos pelo `/signup`** (teste B abaixo) ou redefina em `/esqueci-senha` (o e-mail cai no Mailpit).

---

## A. Admin da plataforma (`admin@leadforge.local`)

Rotas do admin: `/admin/organizacoes` e `/admin/organizacoes/[id]`.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| A1 | Login em `/login` | Entra e vai para a área de admin/dashboard | [ ] | |
| A2 | Abrir `/admin/organizacoes` | Lista **todas** as organizações (6 hoje), não só a sua | [ ] | |
| A3 | Abrir o detalhe de uma org de tenant (`/admin/organizacoes/[id]`) | Vê plano/assinatura (`trialing` / `active`) e status | [ ] | |
| A4 | Suspender e reativar uma org de teste | Status muda; a org suspensa não consegue usar o app (ver B7) | [ ] | |
| A5 | Criar org de cortesia (SPEC-040), se a tela oferecer | Nasce sem cobrança; e-mail de boas-vindas no Mailpit | [ ] | |
| A6 | Ações do admin geram registro de auditoria | Conferir no detalhe da org / log da plataforma | [ ] | |
| A7 | Sair e logar com `platformadmin@leadforge.local` (sem org) | Entra e vê só a área de admin; não quebra por não ter org | [ ] | |

## B. Tenant (`provider`)

Crie **dois tenants** para testar isolamento: **Tenant A** e **Tenant B**.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| B1 | `/signup` como Tenant A (e-mail novo) | Cria org + usuário e segue para o checkout (mock) | [ ] | |
| B2 | Concluir o checkout mock | Org fica `trialing`; cai no `/dashboard` | [ ] | |
| B3 | Repetir B1 em outra janela anônima para Tenant B | Segunda org independente | [ ] | |
| B4 | Tenant A: criar um lead, uma sequence e uma campanha | Aparecem em `/leads`, `/sequences`, `/campanhas` | [ ] | |
| B5 | **Isolamento**: logado como B, abrir `/leads`, `/sequences`, `/campanhas` | **Nada do Tenant A aparece** | [ ] | |
| B6 | **Isolamento por URL**: copie `/leads/<id>` do lead de A e abra como B | 404/erro, nunca mostra o lead | [ ] | |
| B7 | **Tenant não acessa admin**: como A, abrir `/admin/organizacoes` | Redireciona/nega | [ ] | |
| B8 | `/configuracoes/assinatura` | Mostra plano e trial da própria org | [ ] | |
| B9 | `/esqueci-senha` com o e-mail de A | Mensagem genérica; e-mail no Mailpit; link abre `/redefinir-senha` | [ ] | |
| B10 | Org suspensa pelo admin (A4): tentar usar o app como esse tenant | Acesso bloqueado com aviso claro | [ ] | |

## C. Multi-tenant N:N (SPEC-049): só depois da 049b entregue

Ainda **não implementado** no frontend quando escrevi isto (a 049b está em andamento). O backend já está aprovado pelo QA.
Rotas previstas: `/organizacoes`, `/configuracoes/equipe`, `/convite/[token]`.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| C1 | Tenant A em `/organizacoes`: criar uma 2ª organização | Vira owner da nova; ela abre trial próprio | [ ] | |
| C2 | Seletor de organização aparece (agora com 2 orgs) e trocar | Dados mudam para a org escolhida; **nada da outra** aparece | [ ] | |
| C3 | Sair e logar de novo | Abre a **última org usada** | [ ] | |
| C4 | `/configuracoes/equipe`: convidar o e-mail de B | E-mail de convite no Mailpit | [ ] | |
| C5 | B abre o link `/convite/<token>` já logado e aceita | B passa a ter 2 orgs e vê o seletor | [ ] | |
| C6 | Reusar o mesmo link de convite | Rejeitado (uso único) | [ ] | |
| C7 | Convite com e-mail diferente do logado | Rejeitado | [ ] | |
| C8 | Gerar **código de entrada** e usá-lo num signup novo ("participar de uma organização") | Entra como `member`, sem checkout | [ ] | |
| C9 | `member` tenta convidar/remover/mudar papel | Telas só leitura / ação negada | [ ] | |
| C10 | Único owner tenta sair ou ser removido | Bloqueado ("nunca sem owner") | [ ] | |
| C11 | Owner remove B da org; B ainda com a sessão aberta nessa org | Perde acesso **na hora** àquela org (as outras seguem) | [ ] | |

## Se algo falhar, me mande

1. O passo (ex.: `B5`), o e-mail logado e a URL.
2. O erro da tela e o que aparece no terminal do `npm run dev`.
3. Para erro de banco: `npx prisma migrate status`.

Falha de isolamento (B5, B6, C2, C11) é **bloqueante**: pare e me avise antes de seguir.
