# Roteiro de testes manuais: admin da plataforma e tenants

Marque `[x]` ao passar. Anote o que falhar na coluna "Observado". Complementa o `docs/PRIMEIROS_PASSOS.md`.
Escrito em 2026-10-10. Rotas e usuários abaixo foram lidos do repo e do banco de dev; **os resultados esperados
são o que a SPEC prevê, não algo que eu tenha executado no navegador.**

## 0. Preparação (uma vez)

- [ ] **0.1** Infra no ar: `colima start` e `docker compose up -d postgres redis` (ver PRIMEIROS_PASSOS fase 1).
- [ ] **0.2** Aplicar as migrations no banco de dev: `npx prisma migrate deploy` (hoje são 39; a última é
  `20261012120000_email_dispatch_log`). Sem isso: convites, seletor de organização, arquivos, criativos e e-mails de cobrança
  falham (tabelas `OrgInvite`, `OrgAuditLog`, `StoredFile`, `Creative*`, `EmailDispatchLog` não existem).
  - É aditivo e seguro. **Não use `migrate dev`**: o banco de dev tem colunas a mais que o schema (`document*`,
    `trialBlocked`, `abacatepayProductId`, de outro clone) e ele proporia apagá-las com os dados (ver PRIMEIROS_PASSOS 1.3).
  - Verificar: `npx prisma migrate status` diz "Database schema is up to date!".
- [ ] **0.3** Reiniciar o `npm run dev` depois da migration (o Prisma Client novo é carregado na subida).
- [ ] **0.4** Cobrança: nada a fazer. `PAYMENT_PROVIDER` ausente = `mock` (checkout sem cartão).
- [ ] **0.5** E-mail sem enviar: Mailpit (`docker run -d --name mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit`),
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

## C. Multi-tenant N:N (SPEC-049, backend e frontend implementados)

Implementada e aprovada pelo QA (049a backend e 049b frontend), mas **nunca vista em navegador**. O seletor de organização fica no topo da sidebar (busca, "Criar organização", "Convidar pessoas" só para owner).
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

## D. Criativos (SPEC-051, provedor mock): precisa de `npm run dev:tick` rodando em outro terminal

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| D1 | `/criativos` > criar um criativo (roteiro curto) | Entra "Na fila" e a página atualiza sozinha | [ ] | |
| D2 | Esperar ~15-30 s | "Gerando" e depois "Pronto"; vídeo placeholder; custo R$ 0,00; aviso "Provedor de demonstração (mock)" | [ ] | |
| D3 | Cancelar um criativo ainda na fila; excluir um pronto | Some/cancela sem erro | [ ] | |
| D4 | Org B abre `/criativos` | **Nada** do tenant A aparece (isolamento, bloqueante) | [ ] | |

## E. E-mails de assinatura (SPEC-052a/052b): conferir no Mailpit (http://localhost:8025)

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| E1 | `/signup` com e-mail novo | Chega "início do trial" (1 só) | [ ] | |
| E2 | Concluir o checkout mock | Chega "Assinatura confirmada" (1 só) | [ ] | |
| E3 | Criar 2ª organização em `/organizacoes` | Chega outro "início do trial" para essa org | [ ] | |
| E4 | Conferir o texto | PT-BR, links absolutos, sem dado sensível; recibo (se aparecer) com rodapé "não é nota fiscal" e só 4 dígitos do cartão | [ ] | |
| E5 | Recibo/renovação/PIX | **Não testável em local** sem webhook real do AbacatePay (só testes com mock) | — | |
| E6 | Falha de pagamento imediata (052b): `POST /api/billing/webhook` com `Authorization: Bearer <MOCK_WEBHOOK_SECRET>` (provedor mock) e JSON `{"eventId":"x1","type":"payment.failed","orgId":"<id>","planKey":"starter","cadence":"monthly","status":"past_due"}` (eventId novo a cada chamada) | Chega "Não conseguimos processar seu pagamento" (1 só, mesmo repetindo com outro eventId; reenviar o mesmo eventId também não duplica) | [ ] | |
| E7 | Régua D+3/D+5/D+7 (052b): rodar `npm run dev:tick` e recuar `Subscription.pastDueSince` no banco de dev (3, 5, 7 dias atrás) de uma org em past_due | Chega 1 e-mail por degrau; D+7 diz "Último aviso: sua conta será suspensa"; nunca D+3/5/7 juntos; reexecutar o tick não repete | [ ] | |
| E8 | Recuperação (052b): mesmo webhook com `"type":"payment.recovered","status":"active"` (eventId novo) | Chega "Pagamento regularizado"; régua para de enviar | [ ] | |
| E9 | Troca de plano (052b): webhook `subscription.updated`, `status:"active"`, `planKey` diferente do atual (org já ativa) | Chega "Seu plano foi alterado para …" com plano anterior e novo | [ ] | |
| E10 | Próxima cobrança (052b): org `active` com ciclo anual (ou `pixManaged`) e `currentPeriodEnd` daqui a <= 7 dias + `npm run dev:tick` | Chega "Sua assinatura renova em breve" (1 por ciclo) | [ ] | |
| E11 | Falha/recuperação de **cartão** AbacatePay | **Não existe** (Q-052-5 aberta) e só testável com provedor real; só a régua por estado/grace (job) cobre cartão. PIX vencido real (`abacatepay_pix_expired_*`) idem: só com AbacatePay real | — | |

## F. Sidebar agrupada (SPEC-057) e seletor de organização (SPEC-049b D-049-16/17)

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| F1 | Abrir o app como tenant, tela larga | Seções com título: Dashboard, Captação de leads, Criativos (selo "New"), Automação, Conta | [ ] | |
| F2 | Recolher a sidebar (ícone) e abrir no celular (Sheet) | Não quebra o layout; menu fecha ao navegar | [ ] | |
| F3 | Teclado (Tab) e item ativo | Foco visível; item da página atual destacado | [ ] | |
| F4 | Seletor no topo, busca por nome (com acento) | Filtra; sem resultado mostra "Nenhuma organização encontrada" | [ ] | |
| F5 | "Criar organização" no seletor | Abre o diálogo; cria e entra na nova | [ ] | |
| F6 | "Convidar pessoas" como owner / como member | Owner vê e convida (e-mail no Mailpit); member não vê | [ ] | |

## G. Busca de leads pelo Google Places (SPEC-015/058): precisa de chave do Google (Fase 8 do `docs/PRIMEIROS_PASSOS.md`)

Antes: chave `places` em `/configuracoes/integracoes` (admin), `LEAD_SEARCH_ENABLED=true` no `.env`, reiniciar o `npm run dev`,
e uma campanha **ativa** com ICP (ex.: "dentistas" em "Curitiba"). Defina teto de orçamento no Google antes.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| G1 | Sem `LEAD_SEARCH_ENABLED` ou sem chave, abrir `/campanhas/[id]` | Botão desabilitado com aviso "indisponível no momento, fale com o suporte" (sem citar variável de ambiente) | [ ] | |
| G2 | Owner clica **Buscar agora** e confirma | Estado "rodando"; recarregar a página mantém o estado; termina com "N novos, M duplicados, K suprimidos" | [ ] | |
| G3 | Ver `/leads` e o Pipeline | Leads novos em `novo_lead`, com telefone/site/endereço; sem e-mail de decisor | [ ] | |
| G4 | Repetir a busca logo em seguida | Quase só duplicados (1 página de até 20 por chamada; paginação não existe ainda) | [ ] | |
| G5 | Passar de 2 buscas manuais no dia na mesma campanha | Bloqueio claro: orçamento esgotado | [ ] | |
| G6 | Logar como **member** da org | Não consegue disparar (só lê o histórico) | [ ] | |
| G7 | Tenant B abre a mesma campanha por URL | 404/negado; nenhum lead de A (isolamento, bloqueante) | [ ] | |
| G8 | Conferir custo no Google Cloud depois | Poucas requisições; confirmar o SKU cobrado (Pro vs Enterprise, ainda não confirmado) | [ ] | |

## Se algo falhar, me mande

1. O passo (ex.: `B5`), o e-mail logado e a URL.
2. O erro da tela e o que aparece no terminal do `npm run dev`.
3. Para erro de banco: `npx prisma migrate status`.

Falha de isolamento (B5, B6, C2, C11) é **bloqueante**: pare e me avise antes de seguir.
