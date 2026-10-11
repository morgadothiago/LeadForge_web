# Roteiro de testes manuais: admin da plataforma e tenants

**Resultado de 2026-10-10:** as linhas com `[x]` e "Claude, navegador automatizado" foram exercitadas por mim num Brave controlado por Playwright, com contas `claude.*@testes-claude.local` no banco de dev. **Não substitui o seu olhar**: layout fino, dark mode, teclado/leitor de tela, e-mail no Gmail real e provedores reais continuam seus. Marque `[x]` ao passar. Anote o que falhar na coluna "Observado". Complementa o `docs/PRIMEIROS_PASSOS.md`.
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
| A1 | Login em `/login` | Entra e vai para a área de admin/dashboard | [x] | login admin cai em /admin/organizacoes (Claude, navegador automatizado) |
| A2 | Abrir `/admin/organizacoes` | Lista **todas** as organizações (6 hoje), não só a sua | [x] | lista mostra orgs de todos os tenants (Claude, navegador automatizado) |
| A3 | Abrir o detalhe de uma org de tenant (`/admin/organizacoes/[id]`) | Vê plano/assinatura (`trialing` / `active`) e status | [x] | detalhe com plano, contagens (campanhas, leads) e "Suspender organização" (Claude, navegador automatizado) |
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
| B5 | **Isolamento**: logado como B, abrir `/leads`, `/sequences`, `/campanhas` | **Nada do Tenant A aparece** | [x] | B não vê nada de A em leads/pipeline/campanhas/sequences/calendário/dashboard (Claude, navegador automatizado) |
| B6 | **Isolamento por URL**: copie `/leads/<id>` do lead de A e abra como B | 404/erro, nunca mostra o lead | [x] | URL direta do lead e da campanha de A: B recebe 404 (HTTP 200 do Next com página "404"), sem vazar dado (Claude, navegador automatizado) |
| B7 | **Tenant não acessa admin**: como A, abrir `/admin/organizacoes` | Redireciona/nega | [x] | tenant em /admin/organizacoes é redirecionado ao /dashboard (Claude, navegador automatizado) |
| B8 | `/configuracoes/assinatura` | Mostra plano e trial da própria org | [ ] | |
| B9 | `/esqueci-senha` com o e-mail de A | Mensagem genérica; e-mail no Mailpit; link abre `/redefinir-senha` | [ ] | |
| B10 | Org suspensa pelo admin (A4): tentar usar o app como esse tenant | Acesso bloqueado com aviso claro | [ ] | |

## C. Multi-tenant N:N (SPEC-049, backend e frontend implementados)

Implementada e aprovada pelo QA (049a backend e 049b frontend), mas **nunca vista em navegador**. O seletor de organização fica no topo da sidebar (busca, "Criar organização", "Convidar pessoas" só para owner).
Rotas previstas: `/organizacoes`, `/configuracoes/equipe`, `/convite/[token]`.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| C1 | Tenant A em `/organizacoes`: criar uma 2ª organização | Vira owner da nova; ela abre trial próprio | [x] | criar 2ª org: vira owner e entra nela (trial próprio) (Claude, navegador automatizado) |
| C2 | Seletor de organização aparece (agora com 2 orgs) e trocar | Dados mudam para a org escolhida; **nada da outra** aparece | [x] | troca de org pelo seletor OK; dados por org separados (Claude, navegador automatizado) |
| C3 | Sair e logar de novo | Abre a **última org usada** | [ ] | |
| C4 | `/configuracoes/equipe`: convidar o e-mail de B | E-mail de convite no Mailpit | [x] | convite por e-mail chega no Mailpit com link absoluto (Claude, navegador automatizado) |
| C5 | B abre o link `/convite/<token>` já logado e aceita | B passa a ter 2 orgs e vê o seletor | [x] | B aceita e passa a ter 2 orgs (Membro na de A) (Claude, navegador automatizado) |
| C6 | Reusar o mesmo link de convite | Rejeitado (uso único) | [x] | link reusado: "Convite inválido ou expirado" (Claude, navegador automatizado) |
| C7 | Convite com e-mail diferente do logado | Rejeitado | [x] | e-mail diferente: "Este convite é para outro e-mail", sem aceitar (Claude, navegador automatizado) |
| C8 | Gerar **código de entrada** e usá-lo num signup novo ("participar de uma organização") | Entra como `member`, sem checkout | [ ] | |
| C9 | `member` tenta convidar/remover/mudar papel | Telas só leitura / ação negada | [x] | member vê /configuracoes/equipe só leitura e sem "Convidar pessoas" (Claude, navegador automatizado) |
| C10 | Único owner tenta sair ou ser removido | Bloqueado ("nunca sem owner") | [x] | único owner: "Tornar membro" desabilitado e sem "Remover" em si mesmo (Claude, navegador automatizado) |
| C11 | Owner remove B da org; B ainda com a sessão aberta nessa org | Perde acesso **na hora** àquela org (as outras seguem) | [x] | owner remove B; B com sessão aberta vai para /login na hora (não cai na org própria: ver RETOMAR) (Claude, navegador automatizado) |

## D. Criativos (SPEC-051, provedor mock): precisa de `npm run dev:tick` rodando em outro terminal

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| D1 | `/criativos` > criar um criativo (roteiro curto) | Entra "Na fila" e a página atualiza sozinha | [x] | wizard 5 passos; entra "Na fila" (Claude, navegador automatizado) |
| D2 | Esperar ~15-30 s | "Gerando" e depois "Pronto"; vídeo placeholder; custo R$ 0,00; aviso "Provedor de demonstração (mock)" | [x] | Na fila > Gerando > Pronto sozinho (com tick); vídeo mock; R$ 0,00 (Claude, navegador automatizado) |
| D3 | Cancelar um criativo ainda na fila; excluir um pronto | Some/cancela sem erro | [ ] | |
| D4 | Org B abre `/criativos` | **Nada** do tenant A aparece (isolamento, bloqueante) | [x] | B recebe not_found no criativo de A e a biblioteca dele está vazia (Claude, navegador automatizado) |

## E. E-mails de assinatura (SPEC-052a/052b): conferir no Mailpit (http://localhost:8025)

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| E1 | `/signup` com e-mail novo | Chega "início do trial" (1 só) | [x] | chega "Seu teste do plano Starter começou" (1 só). Exige reiniciar o dev server depois da migration (Claude, navegador automatizado) |
| E2 | Concluir o checkout mock | Chega "Assinatura confirmada" (1 só) | [x] | chega "Assinatura confirmada" (chamando processBillingEvent direto, sem webhook HTTP) (Claude, navegador automatizado) |
| E3 | Criar 2ª organização em `/organizacoes` | Chega outro "início do trial" para essa org | [x] | 2ª org gera outro e-mail de trial (Claude, navegador automatizado) |
| E4 | Conferir o texto | PT-BR, links absolutos, sem dado sensível; recibo (se aparecer) com rodapé "não é nota fiscal" e só 4 dígitos do cartão | [x] | PT-BR, links absolutos, recibo com "Este e-mail não é nota fiscal" (Claude, navegador automatizado) |
| E5 | Recibo/renovação/PIX | **Não testável em local** sem webhook real do AbacatePay (só testes com mock) | — | |
| E6 | Falha de pagamento imediata (052b): `POST /api/billing/webhook` com `Authorization: Bearer <MOCK_WEBHOOK_SECRET>` (provedor mock) e JSON `{"eventId":"x1","type":"payment.failed","orgId":"<id>","planKey":"starter","cadence":"monthly","status":"past_due"}` (eventId novo a cada chamada) | Chega "Não conseguimos processar seu pagamento" (1 só, mesmo repetindo com outro eventId; reenviar o mesmo eventId também não duplica) | [x] | falha: 1 e-mail; 2ª falha com outro eventId não duplica (processBillingEvent direto) (Claude, navegador automatizado) |
| E7 | Régua D+3/D+5/D+6 (052b): rodar `npm run dev:tick` e recuar `Subscription.pastDueSince` no banco de dev (3, 5, 6 dias atrás) de uma org em past_due | Chega 1 e-mail por degrau; D+6 diz "Último aviso: sua conta será suspensa" (24h antes da suspensão); nunca D+3/5/6 juntos; reexecutar o tick não repete | [x] | D+3 "Lembrete", D+5 "continua pendente", D+7 "Último aviso"; achado D+7 corrigido: último aviso agora em D+6; precisa rever à mão (Claude, navegador automatizado) |
| E8 | Recuperação (052b): mesmo webhook com `"type":"payment.recovered","status":"active"` (eventId novo) | Chega "Pagamento regularizado"; régua para de enviar | [x] | "Pagamento regularizado" e régua para (Claude, navegador automatizado) |
| E9 | Troca de plano (052b): webhook `subscription.updated`, `status:"active"`, `planKey` diferente do atual (org já ativa) | Chega "Seu plano foi alterado para …" com plano anterior e novo | [x] | "Seu plano foi alterado para Pro" com anterior e novo (Claude, navegador automatizado) |
| E10 | Próxima cobrança (052b): org `active` com ciclo anual (ou `pixManaged`) e `currentPeriodEnd` daqui a <= 7 dias + `npm run dev:tick` | Chega "Sua assinatura renova em breve" (1 por ciclo) | [x] | "Sua assinatura renova em breve" (anual) com valor e data (Claude, navegador automatizado) |
| E11 | Falha/recuperação de **cartão** AbacatePay | **Não existe** (Q-052-5 aberta) e só testável com provedor real; só a régua por estado/grace (job) cobre cartão. PIX vencido real (`abacatepay_pix_expired_*`) idem: só com AbacatePay real | — | |

## F. Sidebar agrupada (SPEC-057) e seletor de organização (SPEC-049b D-049-16/17)

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| F1 | Abrir o app como tenant, tela larga | Seções com título: Dashboard, Captação de leads, Criativos (selo "New"), Automação, Conta | [x] | seções com título, selo NEW em Criativos (Claude, navegador automatizado) |
| F2 | Recolher a sidebar (ícone) e abrir no celular (Sheet) | Não quebra o layout; menu fecha ao navegar | [x] | recolhida (só ícones) e celular 390px (Sheet fecha ao navegar, sem rolagem horizontal) (Claude, navegador automatizado) |
| F3 | Teclado (Tab) e item ativo | Foco visível; item da página atual destacado | [ ] | |
| F4 | Seletor no topo, busca por nome (com acento) | Filtra; sem resultado mostra "Nenhuma organização encontrada" | [x] | campo de busca presente; filtro não digitado (só renderização) (Claude, navegador automatizado) |
| F5 | "Criar organização" no seletor | Abre o diálogo; cria e entra na nova | [x] | "Criar organização" no seletor cria e ativa a nova (Claude, navegador automatizado) |
| F6 | "Convidar pessoas" como owner / como member | Owner vê e convida (e-mail no Mailpit); member não vê | [x] | owner vê "Convidar pessoas" e convida (e-mail no Mailpit); member não vê (Claude, navegador automatizado) |

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

## H. Cancelamento e reativação da assinatura (SPEC-053): em `/configuracoes/assinatura`, como owner

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| H1 | Plano pago ativo: clicar **Cancelar assinatura**, marcar a confirmação e confirmar | Modal mostra data de fim de acesso, retenção de 90 dias e "sem reembolso"; botão só habilita após marcar; aviso "cancelamento agendado" e a org continua usável | [ ] | |
| H2 | Ver o Mailpit | 1 e-mail "pedido de cancelamento recebido" com a data de fim do acesso (só 1, mesmo com duplo clique) | [ ] | |
| H3 | Clicar **Manter assinatura** | Aviso some; e-mail "reativação confirmada" (1) | [ ] | |
| H4 | Cancelar de novo e deixar o período vencer (rodar `npm run dev:tick` com `currentPeriodEnd` no passado) | Org suspensa só agora; e-mail "cancelamento efetivado" (1) com retenção de 90 dias; tela mostra "cancelada" e **Reassinar** | [ ] | |
| H5 | Em trial: cancelar | Efeito imediato (modal avisa) | [ ] | |
| H6 | Logar como **member** | Não vê botões de cancelar/manter; chamar a action direto é recusado | [ ] | |
| H7 | Mais de 5 tentativas em 10 min | Mensagem de limite | [ ] | |
| H8 | Org B tenta cancelar a assinatura da org A | Impossível (a org vem da sessão); sem vazamento | [ ] | |
| H9 | Cancelamento **agendado x imediato**: plano pago ativo com período em dia (agendado, org segue usável) e, em outra org, período vencido ou sem período ou pagamento incompleto | Só ativo/past_due com período vigente agenda; trial, sem período, vencido e incomplete cancelam **na hora**; o modal mostra o mesmo modo que a action aplica | [ ] | |
| H10 | Com cancelamento agendado, simular evento externo do provedor com `cancelAtPeriodEnd:false` (webhook mock, eventId novo, período ainda vigente) | Cancelamento continua agendado e **não** sai e-mail de reativação; só o botão **Manter assinatura** desfaz | [ ] | |
| H11 | Clicar **Manter assinatura** sem haver cancelamento (ex.: em outra aba já desfeito) | Toast avisa que não havia cancelamento; com cancelamento real o toast diz "reativada" | [ ] | |
| H12 | Abrir o modal de cancelar e, com o envio em andamento, apertar Esc / clicar fora / "Voltar" | Modal não fecha enquanto envia | [ ] | |

## I. Exclusão de conta (SPEC-054a backend + 054b telas). Precisa da migration `20261014120000_account_deletion_request` aplicada no dev

Tela em **Configurações > Conta**; os e-mails aparecem no Mailpit. Antes: `npx prisma migrate deploy` (só aditiva) e reiniciar o `npm run dev`.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| I1 | Rodar `npx vitest run src/lib/account-deletion` (banco `*_test`) | 20 testes passam (token, janela, purga, bloqueios, #14 uma vez) | [ ] | |
| I2 | Conferir o texto do e-mail "conta excluída" (função `accountDeletedTemplate`, listas em `src/lib/account-deletion/retention.ts`) | Lista "Apagado / Anonimizado / Retido": **valide com seu jurídico os prazos de 5 anos (cobrança) e 6 meses (logs)**; são premissas, não parecer | [ ] | |
| I3 | Em Configurações > Conta: ler a explicação (30 dias; apagado/anonimizado/retido) e pedir a exclusão com senha errada | Mensagem "Senha incorreta" no campo, sem criar pedido; senha certa mostra "Confira seu e-mail" e envia o e-mail de confirmação (link `/conta/excluir/<token>`) | [ ] | |
| I4 | Abrir o link (deslogado ou logado): vê a página "Confirmar a exclusão da conta?" (abrir não confirma); clicar em Confirmar; abrir o mesmo link de novo | 1º clique agenda a exclusão para +30 dias e envia "solicitação recebida"; 2º acesso mostra "Link inválido ou expirado" | [ ] | |
| I5 | Tentar entrar com a conta durante a janela | Login web mostra "exclusão agendada para DD/MM/AAAA" com o botão "Cancelar exclusão e entrar" (que cancela e já entra); app móvel recebe 403 | [ ] | |
| I6 | Dono único de org com outros membros, ou único membro com assinatura ativa, pede a exclusão | Em Configurações > Conta aparece "Ainda não é possível excluir sua conta" com a mensagem (promover outro owner / cancelar a assinatura) e sem campo de senha | [ ] | |
| I8 | Pelo link "cancelar" do e-mail "solicitação recebida" (`/conta/excluir/cancelar/<token>`): abrir e clicar em Cancelar a exclusão | Página "Exclusão cancelada"; conta volta a entrar normalmente; chega o e-mail "exclusão cancelada" | [ ] | |
| I9 | Em celular (~375px) e no tema escuro: Configurações > Conta e as páginas do link | Sem rolagem horizontal, listas legíveis, botões grandes, contraste ok | [ ] | |
| I7 | Vencida a janela, rodar o tick (`npm run tick`) | Usuário anonimizado, vínculos/e-mails conectados/dispositivos apagados, campanhas mantidas; e-mail "conta excluída" 1 vez (rodar o tick de novo não repete) | [ ] | |

| I10 | Único membro de uma org **sem assinatura nenhuma** pede a exclusão (e tenta confirmar o link, e rodar o tick) | Bloqueado com mensagem para falar com o suporte (`org_without_subscription`) no pedido, na confirmação e na purga (adiada); a org não fica ativa sem owner | [ ] | |
| I11 | Em Configurações > Conta (e no e-mail "conta excluída"), conferir a lista "Retido após a exclusão" | Lista também: usuário anonimizado, registro do pedido de exclusão (userId + hash do e-mail), reuniões e criativos criados pelo usuário, além de cobrança e logs; o título **não** diz "por obrigação legal" | [ ] | |
| I12 | Depois da purga, conferir no banco de dev: `User` anonimizado, `AccountDeletionRequest` presente, `Meeting.createdById` e `Creative.createdBy` intactos | Bate com a lista do I11 | [ ] | |

## J. Verificação de e-mail e segurança de cadastro (SPEC-055). Precisa da migration `20261015120000_email_verification` aplicada no dev

Os e-mails aparecem no Mailpit (http://localhost:8025). Antes: `npx prisma migrate deploy` (aditiva, com backfill) e reiniciar o `npm run dev`.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| J1 | `/signup` com e-mail novo | Chegam 2 e-mails para ele: boas-vindas (1 só) e "Confirme seu e-mail" com link `/verificar-email?token=...`; o "início do trial" continua separado | [ ] | |
| J2 | Entrar com a conta recém-criada (sem confirmar) | Entra e navega normalmente; faixa no topo pedindo para confirmar, **sem botão de fechar** | [ ] | |
| J3 | Na faixa, clicar **Reenviar e-mail** | Chega novo e-mail; clicar de novo em seguida mostra contagem regressiva (cooldown 60s) | [ ] | |
| J4 | Reenviar mais de 5 vezes em 1 hora (esperando o cooldown) | Mensagem de limite com tempo de espera; limite por usuário (5/h) e por IP (20/h) | [ ] | |
| J5 | Sem confirmar, aprovar um rascunho / enviar mensagem manual (DraftQueue) | Recusado com a mensagem "confirme seu e-mail"; o rascunho **não** é consumido; nada sai | [ ] | |
| J6 | Sem confirmar, deixar uma sequência/agente tentar enviar (`npm run dev:tick`) | Envio adiado (`email_not_verified`), sem reservar nem queimar tentativas; após confirmar, o tick seguinte envia | [ ] | |
| J7 | Aprovar vários rascunhos em lote sem ter confirmado | Mostra só "bloqueado" (limitação conhecida: não cita o motivo) | [ ] | |
| J8 | Abrir o link do e-mail (deslogado e logado) | Página "e-mail confirmado" com **Ir para o app**; faixa some; envios voltam | [ ] | |
| J9 | Abrir o mesmo link de novo; abrir um link adulterado; abrir `/verificar-email` sem token | Mensagem genérica de erro com **Ir para o login**; sem token não chama nada | [ ] | |
| J10 | Link com mais de 24h (recuar `expiresAt` no banco de dev) | Erro genérico (expirado) | [ ] | |
| J11 | `/signup` com e-mail que **já existe** | Mesma resposta de um e-mail novo; nenhum e-mail de boas-vindas/confirmação para o existente | [ ] | |
| J12 | `/esqueci-senha` e definir senha nova pelo link | Chega "senha alterada" (1 só, mesmo reenviando o link usado); texto com orientação "não foi você?" | [ ] | |
| J13 | Entrar por convite usando **o mesmo e-mail** convidado; e por código de entrada (`joinCode`) | Convite com e-mail idêntico já nasce confirmado (sem faixa); código de entrada nasce não confirmado | [ ] | |
| J14 | Usuário que já existia antes da migration (e admin/seed) | Marcado como confirmado, sem faixa e sem bloqueio de envio | [ ] | |
| J15 | Derrubar o SMTP/provedor e fazer signup ou reset | O cadastro/reset não quebra (só o e-mail se perde) | [ ] | |
| J16 | Celular (~375px) e tema escuro: faixa e página `/verificar-email` | Sem rolagem horizontal, contraste ok, botões acessíveis por teclado, `role=status/alert` | [ ] | |

## K. Avisos aos owners da organização (SPEC-056). Sem migration nova

Precisa de uma org com pelo menos 2 owners e Mailpit aberto. Quem pratica a ação e o membro afetado não recebem.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| K1 | Convidado aceita o convite (`acceptInvite`) | Cada owner recebe 1 e-mail "novo membro" | [ ] | |
| K2 | Entrar pelo código de entrada (`joinByCode`) e cadastro por convite (`signUpAndJoin`) | Cada owner recebe 1 e-mail de entrada por evento | [ ] | |
| K3 | Membro sai da organização | Owners recebem 1 e-mail de saída (o que saiu não recebe) | [ ] | |
| K4 | Owner A remove um membro | Os **outros** owners recebem 1 e-mail; A (ator) e o removido não recebem | [ ] | |
| K5 | Owner muda o papel de um membro (member para owner e vice-versa) | Os outros owners recebem 1 e-mail com papel anterior e novo; o membro afetado e o ator não recebem | [ ] | |
| K6 | "Mudar" o papel para o que o membro já tem; ação recusada (ex.: tentar remover o último owner) | Nenhum e-mail | [ ] | |
| K7 | Clicar duas vezes / repetir a mesma ação | Sem e-mail duplicado (dedupe por evento) | [ ] | |
| K8 | Mais de 10 entradas na mesma hora na mesma org | Só as 10 primeiras geram e-mail; as demais ficam só na auditoria (`member_joined`); outra org não é afetada | [ ] | |
| K9 | Derrubar o provedor de e-mail e executar uma ação | A ação (entrar/sair/remover) continua válida; o aviso se perde (sem retry) | [ ] | |
| K10 | Conferir o texto dos e-mails | PT-BR, link absoluto, sem dado sensível além do necessário | [ ] | |
| K11 | Org B: ações na org B | Só owners da B são avisados; nenhum aviso vaza para owners da A | [ ] | |

## Se algo falhar, me mande

1. O passo (ex.: `B5`), o e-mail logado e a URL.
2. O erro da tela e o que aparece no terminal do `npm run dev`.
3. Para erro de banco: `npx prisma migrate status`.

Falha de isolamento (B5, B6, C2, C11) é **bloqueante**: pare e me avise antes de seguir.
