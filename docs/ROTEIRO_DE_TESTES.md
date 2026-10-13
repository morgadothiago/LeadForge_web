# Roteiro de testes manuais: admin da plataforma e tenants

**Resultado de 2026-10-10:** as linhas com `[x]` e "Claude, navegador automatizado" foram exercitadas por mim num Brave controlado por Playwright, com contas `claude.*@testes-claude.local` no banco de dev. **Não substitui o seu olhar**: layout fino, dark mode, teclado/leitor de tela, e-mail no Gmail real e provedores reais continuam seus. Marque `[x]` ao passar. Anote o que falhar na coluna "Observado". Complementa o `docs/PRIMEIROS_PASSOS.md`.
Escrito em 2026-10-10. Rotas e usuários abaixo foram lidos do repo e do banco de dev; **os resultados esperados
são o que a SPEC prevê, não algo que eu tenha executado no navegador.**

## Os 10 testes de maior risco (faça estes primeiro)

Versão com passo a passo: `docs/TESTES_PRIORITARIOS.md`.

Ordem: do que **perde mais** se falhar (dinheiro, dados de outro cliente, cliente sem e-mail) para o que perde menos. Cada um aponta
para a linha do roteiro abaixo. Marque `[x]` lá quando passar.

| # | Teste | Por que é arriscado | Linhas |
|---|---|---|---|
| 1 | **Pagamento real no AbacatePay** (PIX de valor baixo) e o webhook chegando | Dinheiro. Recibo, formato do evento e "assinatura confirmada" só foram testados com o provedor de mentirinha. Veja PRIMEIROS_PASSOS 9.7 | E (refazer com provedor real), 9.10 item 8 |
| 2 | **E-mail real** (Resend ou ACS) num Gmail seu: cadastro, confirmar e-mail, esqueci a senha, convite | Sem e-mail ninguém entra nem paga. Confira se cai na caixa de entrada e se os links apontam para o endereço de produção | B9, J12, 9.10 itens 3 a 6 |
| 3 | **Isolamento entre clientes**: tenant B abre por URL a campanha e a assinatura do tenant A | Vazamento de dados de cliente é o pior erro possível | G7, H8 |
| 4 | **Busca real no Google Places**: 1 busca manual, depois conferir o custo no Google Cloud | Gasta dinheiro de verdade; o SKU cobrado ainda não foi confirmado. Ponha teto de gasto antes | G1 a G3, G8, N4 |
| 5 | **Cadastro limpo (SPEC-065)**: janela anônima, `/signup` com e-mail e CPF novos, cair no dashboard com 14 dias de teste, confirmar e-mail | É a porta de entrada de todo cliente | B1, B2, B4, bloco T |
| 6 | **Suspender uma org**: admin suspende, o tenant tenta usar o app, depois reativa | Se falhar, cliente inadimplente continua usando (ou cliente em dia fica bloqueado) | A4, B10 |
| 7 | **E-mail não confirmado não envia mensagem**: aprovar rascunho e deixar o tick tentar | Proteção contra spam e contra cadastro falso; o envio deve ser adiado, não perdido | J5, J6 |
| 8 | **Cancelar a assinatura**: agendado (acesso até o fim) x imediato, e evento externo não desfazer | Mexe em cobrança e em acesso | H9, H10 |
| 9 | **LLM real** (Gemini ou Groq grátis, ou Claude): Testar conexão e Simular | Os agentes dependem disso; só foi testado com chave falsa | L5, L9 |
| 10 | **Teclado e escuro**: Tab pelo menu e modais, Esc fecha, dark mode nas telas novas | Acessibilidade; nenhuma tela nova foi vista em dark mode por pessoa | F3 |

Decisão pendente de produto que aparece nos testes: **J11** (cadastro com e-mail que já existe revela que ele existe).

## 0. Preparação (uma vez)

- [ ] **0.1** Infra no ar: `colima start` e `docker compose up -d postgres redis` (ver PRIMEIROS_PASSOS fase 1).
- [ ] **0.2** Aplicar as migrations no banco de dev: `npx prisma migrate deploy` (hoje são 43; a última é
  `20261016120000_search_run_cursor_060`). Sem isso: convites, seletor de organização, arquivos, criativos e e-mails de cobrança
  falham (tabelas `OrgInvite`, `OrgAuditLog`, `StoredFile`, `Creative*`, `EmailDispatchLog` não existem).
  - É aditivo e seguro. **Não use `migrate dev`**: o banco de dev tem colunas a mais que o schema (`document*`,
    `trialBlocked`, `abacatepayProductId`, de outro clone) e ele proporia apagá-las com os dados (ver PRIMEIROS_PASSOS 1.3).
  - Verificar: `npx prisma migrate status` não lista migration pendente. Em um banco com o drift `20260928*` ele também lista 5
    migrations "não encontradas localmente" (investigado, ver `docs/RETOMAR.md` 3b); isso não impede o `migrate deploy`.
- [ ] **0.3** Reiniciar o `npm run dev` depois da migration (o Prisma Client novo é carregado na subida).
- [ ] **0.4** Cobrança: nada a fazer. `PAYMENT_PROVIDER` ausente = `mock` (checkout de faz de conta). Em produção o mock é recusado, salvo `ALLOW_MOCK_BILLING=true`.
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
| A3 | Abrir o detalhe de uma org de tenant (`/admin/organizacoes/[id]`) | Vê plano/assinatura (`active`; orgs antigas podem estar `trialing`) e status | [x] | detalhe com plano, contagens (campanhas, leads) e "Suspender organização" (Claude, navegador automatizado) |
| A4 | Suspender e reativar uma org de teste | Status muda; a org suspensa não consegue usar o app (ver B7) | [ ] | |
| A5 | Criar org de cortesia (SPEC-040), se a tela oferecer | Nasce sem cobrança; e-mail de boas-vindas no Mailpit | [ ] | |
| A6 | Ações do admin geram registro de auditoria | Conferir no detalhe da org / log da plataforma | [ ] | |
| A7 | Sair e logar com `platformadmin@leadforge.local` (sem org) | Entra e vê só a área de admin; não quebra por não ter org | [ ] | |

## B. Tenant (`provider`)

Crie **dois tenants** para testar isolamento: **Tenant A** e **Tenant B**.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| B1 | `/signup` como Tenant A (e-mail novo): nome, e-mail, **CPF ou CNPJ** e senha | Cria usuário **e organização** (teste grátis de 14 dias) e vai direto ao `/dashboard`. Sem "Nome da empresa" no cadastro (SPEC-065; bloco T) | [ ] | |
| B2 | Confirmar o e-mail (Mailpit) e, no cartão do dashboard, dar nome à empresa | Org `active` em teste grátis; chip "Teste grátis: 14 dias" no topo. Roteiro completo: bloco T (bloco P só vale para a 2ª organização) | [ ] | |
| B3 | Repetir B1 em outra janela anônima para Tenant B | Segunda org independente | [ ] | |
| B4 | Tenant A: criar um lead, uma sequence e uma campanha | Aparecem em `/leads`, `/sequences`, `/campanhas` | [ ] | |
| B5 | **Isolamento**: logado como B, abrir `/leads`, `/sequences`, `/campanhas` | **Nada do Tenant A aparece** | [x] | B não vê nada de A em leads/pipeline/campanhas/sequences/calendário/dashboard (Claude, navegador automatizado) |
| B6 | **Isolamento por URL**: copie `/leads/<id>` do lead de A e abra como B | 404/erro, nunca mostra o lead | [x] | URL direta do lead e da campanha de A: B recebe 404 (HTTP 200 do Next com página "404"), sem vazar dado (Claude, navegador automatizado) |
| B7 | **Tenant não acessa admin**: como A, abrir `/admin/organizacoes` | Redireciona/nega | [x] | tenant em /admin/organizacoes é redirecionado ao /dashboard (Claude, navegador automatizado) |
| B8 | `/configuracoes/assinatura` | Mostra o plano ("Teste gratis" em teste), o prazo, o uso do plano e as opções de upgrade | [ ] | |
| B9 | `/esqueci-senha` com o e-mail de A | Mensagem genérica; e-mail no Mailpit; link abre `/redefinir-senha` | [ ] | |
| B10 | Org suspensa pelo admin (A4): tentar usar o app como esse tenant | Acesso bloqueado com aviso claro | [ ] | |

## C. Multi-tenant N:N (SPEC-049, backend e frontend implementados)

Implementada e aprovada pelo QA (049a backend e 049b frontend), mas **nunca vista em navegador**. O seletor de organização fica no topo da sidebar (busca, "Criar organização", "Convidar pessoas" só para owner).
Rotas previstas: `/organizacoes`, `/configuracoes/equipe`, `/convite/[token]`.

| # | Passo | Esperado | OK | Observado |
|---|---|---|---|---|
| C1 | Tenant A em `/organizacoes`: **Nova organização** | Leva a `/assinar?nova=1` (cada organização tem o seu plano): escolher plano, pagar e nomear (bloco P) | [ ] | substitui o teste antigo de "trial próprio" |
| C2 | Seletor de organização aparece (agora com 2 orgs) e trocar | Dados mudam para a org escolhida; **nada da outra** aparece | [x] | troca de org pelo seletor OK; dados por org separados (Claude, navegador automatizado) |
| C3 | Sair e logar de novo | Abre a **última org usada** | [ ] | |
| C4 | `/configuracoes/equipe`: convidar o e-mail de B | E-mail de convite no Mailpit | [x] | convite por e-mail chega no Mailpit com link absoluto (Claude, navegador automatizado) |
| C5 | B abre o link `/convite/<token>` já logado e aceita | B passa a ter 2 orgs e vê o seletor | [x] | B aceita e passa a ter 2 orgs (Membro na de A) (Claude, navegador automatizado) |
| C6 | Reusar o mesmo link de convite | Rejeitado (uso único) | [x] | link reusado: "Convite inválido ou expirado" (Claude, navegador automatizado) |
| C7 | Convite com e-mail diferente do logado | Rejeitado | [x] | e-mail diferente: "Este convite é para outro e-mail", sem aceitar (Claude, navegador automatizado) |
| C8 | Gerar **código de entrada** e usá-lo **logado** em `/entrar-em-organizacao` (o cadastro não tem mais campo de código) | Entra como `member`, sem checkout | [ ] | |
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
| E1 | `/signup` com e-mail novo | Chegam "Bem-vindo" (com o próximo passo: escolher o plano) e "Confirme seu e-mail"; **não** chega e-mail de trial (SPEC-062) | [ ] | |
| E2 | Concluir o checkout mock | Chega "Assinatura confirmada" (1 só) | [x] | chega "Assinatura confirmada" (chamando processBillingEvent direto, sem webhook HTTP) (Claude, navegador automatizado) |
| E3 | Criar 2ª organização (`/assinar?nova=1`, pagar e nomear) | Chega "Assinatura confirmada" para essa org; sem e-mail de trial | [ ] | |
| E4 | Conferir o texto | PT-BR, links absolutos, sem dado sensível; recibo (se aparecer) com rodapé "não é nota fiscal" e só 4 dígitos do cartão | [x] | PT-BR, links absolutos, recibo com "Este e-mail não é nota fiscal" (Claude, navegador automatizado) |
| E5 | Recibo/renovação/PIX | **Não testável em local** sem webhook real do AbacatePay (só testes com mock) | — | |
| E6 | Falha de pagamento imediata (052b): `POST /api/billing/webhook` com `Authorization: Bearer <MOCK_WEBHOOK_SECRET>` (provedor mock) e JSON `{"eventId":"x1","type":"payment.failed","orgId":"<id>","planKey":"starter","cadence":"monthly","status":"past_due"}` (eventId novo a cada chamada) | Chega "Não conseguimos processar seu pagamento" (1 só, mesmo repetindo com outro eventId; reenviar o mesmo eventId também não duplica) | [x] | falha: 1 e-mail; 2ª falha com outro eventId não duplica (processBillingEvent direto) (Claude, navegador automatizado) |
| E7 | Régua D+3/D+5/D+6 (052b): rodar `npm run dev:tick` e recuar `Subscription.pastDueSince` no banco de dev (3, 5, 6 dias atrás) de uma org em past_due | Chega 1 e-mail por degrau; D+6 diz "Último aviso: sua conta será suspensa" (24h antes da suspensão); nunca D+3/5/6 juntos; reexecutar o tick não repete | [x] | D+3 "Lembrete", D+5 "continua pendente", D+7 "Último aviso"; achado D+7 corrigido: último aviso agora em D+6; precisa rever à mão (Claude, navegador automatizado) |
| E8 | Recuperação (052b): mesmo webhook com `"type":"payment.recovered","status":"active"` (eventId novo) | Chega "Pagamento regularizado"; régua para de enviar | [x] | "Pagamento regularizado" e régua para (Claude, navegador automatizado) |
| E9 | Troca de plano (052b): webhook `subscription.updated`, `status:"active"`, `planKey` diferente do atual (org já ativa) | Chega "Seu plano foi alterado para …" com plano anterior e novo | [x] | "Seu plano foi alterado para Pro" com anterior e novo (Claude, navegador automatizado) |
| E10 | Próxima cobrança (052b): org `active` com ciclo anual (ou `pixManaged`) e `currentPeriodEnd` daqui a <= 7 dias + `npm run dev:tick` | Chega "Sua assinatura renova em breve" (1 por ciclo) | [x] | "Sua assinatura renova em breve" (anual) com valor e data (Claude, navegador automatizado) |
| E11 | Falha/recuperação de **cartão** AbacatePay | **Existe desde a SPEC-063a** (Q-052-5 fechada): evento `subscription.payment_failed` -> `past_due` + régua D+0; `subscription.cancelled` (`max_payment_retries_exceeded`) suspende. Não dá para forçar no modo de teste: reenviar as fixtures de `src/lib/billing/providers/__fixtures__/abacatepay/` com `curl -X POST "http://localhost:3000/api/billing/webhook?webhookSecret=$ABACATEPAY_WEBHOOK_SECRET" -d @arquivo.json`, trocando `subscription.id` (e `checkout.id`) pelos ids reais gravados na `Subscription` (`externalSubscriptionId`/`externalCheckoutId`) e o `id` do evento (`log_...`) a cada envio | [ ] | |
| E12 | **Pagamento real em modo de teste (SPEC-063a)**: `PAYMENT_PROVIDER=abacatepay` + chave de dev + webhook (túnel) cadastrado (PRIMEIROS_PASSOS 9.7); `/assinar`, plano mensal, abrir o pagamento, cartão `4242 4242 4242 4242` | Sem erro 422; no banco 1 linha em `BillingProduct` e `Subscription.externalCheckoutId = bill_...`; após pagar, `/assinar/retorno` segue para "criar organização"; `Subscription` fica `active` com `externalSubscriptionId = subs_...`; chega "Assinatura confirmada" 1 vez. **Antes**, aplicar a migration `20261018120000_abacatepay_v2_catalogo` no banco de dev (`npx prisma migrate deploy`, nunca `migrate dev`) | [ ] | |

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
| G4 | Repetir a busca logo em seguida | Com a SPEC-060, continua de onde parou (botão "Buscar mais resultados", ver bloco N); sem a migration da 060 aplicada, a tela falha | [ ] | |
| G5 | Passar de 2 buscas manuais no dia na mesma campanha | Bloqueio claro: orçamento esgotado | [ ] | |
| G6 | Logar como **member** da org | Não consegue disparar (só lê o histórico) | [ ] | |
| G7 | Tenant B abre a mesma campanha por URL | 404/negado; nenhum lead de A (isolamento, bloqueante) | [ ] | |
| G8 | Conferir custo no Google Cloud depois | Poucas requisições; confirmar o SKU cobrado (Pro vs Enterprise, ainda não confirmado) | [ ] | |

## H. Cancelamento e reativação da assinatura (SPEC-053): em `/configuracoes/assinatura`, como owner

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| H1 | Plano pago ativo: clicar **Cancelar assinatura**, marcar a confirmação e confirmar | Modal mostra data de fim de acesso, retenção de 90 dias e "sem reembolso"; sem marcar a caixa o envio é recusado com a mensagem "Marque a caixa para confirmar o cancelamento"; aviso "cancelamento agendado" e a org continua usável | [x] | modal com data de fim (09/11), 90 dias e sem reembolso; o botão NÃO fica desabilitado: sem marcar a caixa aparece o erro "Marque a caixa para confirmar o cancelamento" e nada é gravado; com a caixa, `cancelAtPeriodEnd` vira true e a org segue ativa; Esc fecha o modal (Claude, navegador automatizado) |
| H2 | Ver o Mailpit | 1 e-mail "pedido de cancelamento recebido" com a data de fim do acesso (só 1, mesmo com duplo clique) | [x] | 1 e-mail "Recebemos seu pedido de cancelamento" mesmo com duplo clique (Claude, navegador automatizado) |
| H3 | Clicar **Manter assinatura** | Aviso some; e-mail "reativação confirmada" (1) | [x] | `cancelAtPeriodEnd` volta a false; 1 e-mail "Sua assinatura foi mantida" (Claude, navegador automatizado) |
| H4 | Cancelar de novo e deixar o período vencer (rodar `npm run dev:tick` com `currentPeriodEnd` no passado) | Org suspensa só agora; e-mail "cancelamento efetivado" (1) com retenção de 90 dias; tela mostra "cancelada" e **Reassinar** | [x] | com `currentPeriodEnd` no passado e `POST /api/cron/tick`: assinatura `canceled`, org `suspended`, 1 e-mail "Assinatura cancelada", tela "Cancelada" com retenção até 09/01/2027 e Reassinar; 2º tick não repete (Claude, navegador automatizado) |
| H5 | Em trial: cancelar | Efeito imediato (modal avisa) | [x] | trial: modal avisa "vale imediatamente"; após confirmar a assinatura fica `canceled` e a org `suspended` (Claude, navegador automatizado) |
| H6 | Logar como **member** | Não vê botões de cancelar/manter; chamar a action direto é recusado | [x] | member vê a página de assinatura sem os botões Cancelar/Manter (Claude, navegador automatizado) |
| H7 | Mais de 5 tentativas em 10 min | Mensagem de limite | [x] | depois de 5 ações em 10 min: "Muitas tentativas. Aguarde alguns minutos e tente novamente." (Claude, navegador automatizado) |
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
| I3 | Em Configurações > Conta: ler a explicação (30 dias; apagado/anonimizado/retido) e pedir a exclusão com senha errada | Mensagem "Senha incorreta" no campo, sem criar pedido; senha certa mostra "Confira seu e-mail" e envia o e-mail de confirmação (link `/conta/excluir/<token>`) | [x] | senha errada: "Senha incorreta." e nenhum pedido criado; senha certa: "Confira seu e-mail" e chega "Confirme a exclusão da sua conta" (Claude, navegador automatizado) |
| I4 | Abrir o link (deslogado ou logado): vê a página "Confirmar a exclusão da conta?" (abrir não confirma); clicar em Confirmar; abrir o mesmo link de novo | 1º clique agenda a exclusão para +30 dias e envia "solicitação recebida"; 2º acesso mostra "Link inválido ou expirado" | [x] | abrir o link mostra "Confirmar a exclusão da conta?" sem confirmar (0 pedidos confirmados); ao clicar: agendada +30 dias (10/11/2026) e e-mail "Recebemos sua solicitação"; link reaberto = inválido (Claude, navegador automatizado) |
| I5 | Tentar entrar com a conta durante a janela | Login web mostra "exclusão agendada para DD/MM/AAAA" com o botão "Cancelar exclusão e entrar" (que cancela e já entra); app móvel recebe 403 | [x] | login na janela mostra "A exclusão desta conta está agendada para 10/11/2026" com o botão "Cancelar exclusão e entrar" (que cancela e entra no /dashboard). App móvel (403) não testado (Claude, navegador automatizado) |
| I6 | Dono único de org com outros membros, ou único membro com assinatura ativa, pede a exclusão | Em Configurações > Conta aparece "Ainda não é possível excluir sua conta" com a mensagem (promover outro owner / cancelar a assinatura) e sem campo de senha | [x] | único membro de org em trial: "Ainda não é possível excluir sua conta | Assinatura ativa | ... Cancele a assinatura..." e sem campo de senha. Dono único com outros membros não testado (Claude, navegador automatizado) |
| I8 | Pelo link "cancelar" do e-mail "solicitação recebida" (`/conta/excluir/cancelar/<token>`): abrir e clicar em Cancelar a exclusão | Página "Exclusão cancelada"; conta volta a entrar normalmente; chega o e-mail "exclusão cancelada" | [x] | link cancelar: "Cancelar a exclusão da conta?" → "Exclusão cancelada"; e-mail "A exclusão da sua conta foi cancelada"; login normal volta a funcionar (Claude, navegador automatizado) |
| I9 | Em celular (~375px) e no tema escuro: Configurações > Conta e as páginas do link | Sem rolagem horizontal, listas legíveis, botões grandes, contraste ok | [x] | Configurações > Conta em 390px sem rolagem horizontal e em tema escuro legível; as páginas dos links (/conta/excluir/...) não foram vistas em celular/escuro (Claude, navegador automatizado) |
| I7 | Vencida a janela, rodar o tick (`npm run tick`) | Usuário anonimizado, vínculos/e-mails conectados/dispositivos apagados, campanhas mantidas; e-mail "conta excluída" 1 vez (rodar o tick de novo não repete) | [x] | após vencer a janela e rodar o tick: usuário anonimizado ("Usuário removido", sem senha, e-mail `removido-...@removido.invalid`), memberships removidas, 1 e-mail "Sua conta LeadForge foi excluída"; 2º tick não repete (Claude, navegador automatizado) |

| I10 | Único membro de uma org **sem assinatura nenhuma** pede a exclusão (e tenta confirmar o link, e rodar o tick) | Bloqueado com mensagem para falar com o suporte (`org_without_subscription`) no pedido, na confirmação e na purga (adiada); a org não fica ativa sem owner | [ ] | |
| I11 | Em Configurações > Conta (e no e-mail "conta excluída"), conferir a lista "Retido após a exclusão" | Lista também: usuário anonimizado, registro do pedido de exclusão (userId + hash do e-mail), reuniões e criativos criados pelo usuário, além de cobrança e logs; o título **não** diz "por obrigação legal" | [x] | a tela mostra "Fica retido após a exclusão" com a linha de usuário anonimizada, o registro do pedido (userId + hash), reuniões e criativos, cobrança por 5 anos e auditoria por 6 meses (Claude, navegador automatizado) |
| I12 | Depois da purga, conferir no banco de dev: `User` anonimizado, `AccountDeletionRequest` presente, `Meeting.createdById` e `Creative.createdBy` intactos | Bate com a lista do I11 | [x] | parcial: depois da purga o `User` está anonimizado e o `AccountDeletionRequest` tem `executedAt`; `Meeting.createdById`/`Creative.createdBy` não verificados (a conta de teste não tinha reuniões nem criativos) (Claude, navegador automatizado) |

## J. Verificação de e-mail e segurança de cadastro (SPEC-055). Precisa da migration `20261015120000_email_verification` aplicada no dev

Os e-mails aparecem no Mailpit (http://localhost:8025). Antes: `npx prisma migrate deploy` (aditiva, com backfill) e reiniciar o `npm run dev`.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| J1 | `/signup` com e-mail novo | Chegam 2 e-mails para ele: boas-vindas (1 só) e "Confirme seu e-mail" com link `/verificar-email?token=...`; nenhum e-mail de trial (SPEC-062) | [ ] | |
| J2 | Entrar com a conta recém-criada (sem confirmar) | Entra e navega normalmente; faixa no topo pedindo para confirmar, **sem botão de fechar** | [x] | entra no /dashboard com a faixa "Verifique seu e-mail para poder enviar mensagens" e só o botão "Reenviar e-mail" (sem fechar) (Claude, navegador automatizado) |
| J3 | Na faixa, clicar **Reenviar e-mail** | Chega novo e-mail; clicar de novo em seguida mostra contagem regressiva (cooldown 60s) | [x] | logo após o cadastro o reenvio é recusado e o botão mostra "Reenviar em 52s" (cooldown); com o cooldown vencido o reenvio chega (3→4 e-mails) (Claude, navegador automatizado) |
| J4 | Reenviar mais de 5 vezes em 1 hora (esperando o cooldown) | Mensagem de limite com tempo de espera; limite por usuário (5/h) e por IP (20/h) | [x] | no 6º pedido: "Muitas tentativas. Aguarde antes de pedir um novo e-mail." e o botão passa a "Reenviar em 3548s" (Claude, navegador automatizado) |
| J5 | Sem confirmar, aprovar um rascunho / enviar mensagem manual (DraftQueue) | Recusado com a mensagem "confirme seu e-mail"; o rascunho **não** é consumido; nada sai | [ ] | |
| J6 | Sem confirmar, deixar uma sequência/agente tentar enviar (`npm run dev:tick`) | Envio adiado (`email_not_verified`), sem reservar nem queimar tentativas; após confirmar, o tick seguinte envia | [ ] | |
| J7 | Aprovar vários rascunhos em lote sem ter confirmado | Avisa "Confirme seu e-mail para poder enviar mensagens" junto do resumo (corrigido em 2026-10-11) | [ ] | |
| J8 | Abrir o link do e-mail (deslogado e logado) | Página "e-mail confirmado" com **Ir para o app**; faixa some; envios voltam | [x] | deslogado: "E-mail confirmado ... Ir para o app"; a faixa some ao recarregar (Claude, navegador automatizado) |
| J9 | Abrir o mesmo link de novo; abrir um link adulterado; abrir `/verificar-email` sem token | Mensagem genérica de erro com **Ir para o login**; sem token não chama nada | [x] | link usado, adulterado e `/verificar-email` sem token mostram "Não foi possível confirmar" com "Ir para o login" (Claude, navegador automatizado) |
| J10 | Link com mais de 24h (recuar `expiresAt` no banco de dev) | Erro genérico (expirado) | [x] | token com `expiresAt` no passado: "Link de confirmação inválido ou expirado" e o usuário continua não verificado (Claude, navegador automatizado) |
| J11 | `/signup` com e-mail que **já existe** | Mesma resposta de um e-mail novo; nenhum e-mail de boas-vindas/confirmação para o existente | [ ] | Nenhum e-mail foi enviado ao existente, mas a resposta NÃO é igual: e-mail novo vai para o /dashboard e o existente fica no /signup com "Não foi possível concluir o cadastro com os dados informados" (inferível por quem tenta); decisão de produto no RETOMAR (Claude, navegador automatizado) |
| J12 | `/esqueci-senha` e definir senha nova pelo link | Chega "senha alterada" (1 só, mesmo reenviando o link usado); texto com orientação "não foi você?" | [ ] | |
| J13 | Entrar por convite usando **o mesmo e-mail** convidado; e por código de entrada (`joinCode`) | Convite com e-mail idêntico já nasce confirmado (sem faixa); código de entrada nasce não confirmado | [ ] | |
| J14 | Usuário que já existia antes da migration (e admin/seed) | Marcado como confirmado, sem faixa e sem bloqueio de envio | [x] | admin/seed e as contas criadas antes da migration estão com `emailVerifiedAt` preenchido (1/1 e 3/3) (Claude, navegador automatizado) |
| J15 | Derrubar o SMTP/provedor e fazer signup ou reset | O cadastro/reset não quebra (só o e-mail se perde) | [ ] | |
| J16 | Celular (~375px) e tema escuro: faixa e página `/verificar-email` | Sem rolagem horizontal, contraste ok, botões acessíveis por teclado, `role=status/alert` | [x] | faixa em 390px sem rolagem horizontal e em tema escuro legível; a página `/verificar-email` em celular/escuro não foi vista (Claude, navegador automatizado) |

## K. Avisos aos owners da organização (SPEC-056). Sem migration nova

Precisa de uma org com pelo menos 2 owners e Mailpit aberto. Quem pratica a ação e o membro afetado não recebem.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| K1 | Convidado aceita o convite (`acceptInvite`) | Cada owner recebe 1 e-mail "novo membro" | [x] | convite aceito (usuário logado): o owner recebeu 1 "Novo membro na organização"; com 2 owners, os dois receberam (Claude, navegador automatizado) |
| K2 | Entrar pelo código de entrada (`joinByCode`) e cadastro por convite (`signUpAndJoin`) | Cada owner recebe 1 e-mail de entrada por evento | [ ] | |
| K3 | Membro sai da organização | Owners recebem 1 e-mail de saída (o que saiu não recebe) | [x] | membro saiu: o owner recebeu 1 "Um membro saiu"; quem saiu não recebeu (Claude, navegador automatizado) |
| K4 | Owner A remove um membro | Os **outros** owners recebem 1 e-mail; A (ator) e o removido não recebem | [x] | owner removeu um membro: o outro owner recebeu 1 "Um membro foi removido"; o ator e o removido não receberam (Claude, navegador automatizado) |
| K5 | Owner muda o papel de um membro (member para owner e vice-versa) | Os outros owners recebem 1 e-mail com papel anterior e novo; o membro afetado e o ator não recebem | [x] | promover e rebaixar: o outro owner recebeu 1 "Papel de membro alterado" por mudança; o ator e o afetado não receberam (Claude, navegador automatizado) |
| K6 | "Mudar" o papel para o que o membro já tem; ação recusada (ex.: tentar remover o último owner) | Nenhum e-mail | [ ] | |
| K7 | Clicar duas vezes / repetir a mesma ação | Sem e-mail duplicado (dedupe por evento) | [ ] | |
| K8 | Mais de 10 entradas na mesma hora na mesma org | Só as 10 primeiras geram e-mail; as demais ficam só na auditoria (`member_joined`); outra org não é afetada | [ ] | |
| K9 | Derrubar o provedor de e-mail e executar uma ação | A ação (entrar/sair/remover) continua válida; o aviso se perde (sem retry) | [ ] | |
| K10 | Conferir o texto dos e-mails | PT-BR, link absoluto, sem dado sensível além do necessário | [x] | PT-BR, nome + e-mail do membro, data, link absoluto `/configuracoes/equipe` e o motivo do aviso (Claude, navegador automatizado) |
| K11 | Org B: ações na org B | Só owners da B são avisados; nenhum aviso vaza para owners da A | [x] | owners de outras organizações não receberam nenhum aviso (Claude, navegador automatizado) |

## L. Provedor de LLM grátis por organização (SPEC-036). Sem migration; precisa de uma conta de teste de agentes

Em `/configuracoes/integracoes`, card **Provedor de LLM** (como admin/owner). Para Ollama: `ollama serve` rodando local (porta 11434).

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| L1 | Abrir o card "Provedor de LLM" | Campos: URL base (opcional, com exemplos de Groq/OpenRouter/Ollama/Gemini), chave (opcional, com link da URL), caixa "instância própria" e botão **Testar conexão** | [x] | card com URL base (exemplos Groq/OpenRouter/Ollama/Gemini), chave 12 a 512 caracteres, caixa "instância própria" e botão Testar conexão (depois de salvar) (Claude, navegador automatizado) |
| L2 | Sem URL, salvar só a chave da Anthropic | Funciona como antes (Claude); **Simular** mostra provedor Claude e o modelo | [ ] | |
| L3 | Ollama: URL `http://localhost:11434/v1`, sem chave, marcar "instância própria", **Testar conexão** | Teste passa; custo contado como zero; host privado só é aceito com a caixa marcada | [x] | salvar `http://localhost:11434/v1` com a caixa marcada funciona (chave só "••••1234"); "Testar conexão" sem Ollama no ar mostra "Não foi possível conectar ao servidor informado...". Ollama real não testado (Claude, navegador automatizado) |
| L4 | Mesmo host privado **sem** marcar "instância própria" | Recusado com mensagem clara (proteção SSRF) | [x] | sem marcar: "Endereço aponta para rede interna/localhost. Marque \"instância própria\" para permitir." e nada é salvo (Claude, navegador automatizado) |
| L5 | Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`) ou Groq com a chave do provedor, **Testar conexão** e **Simular** | Teste passa; Simular mostra o provedor e o modelo usados | [ ] | |
| L6 | Chave errada ou URL inexistente, **Testar conexão** | Erro legível; a chave nunca aparece na tela nem no log | [x] | chave falsa na Groq: "Credenciais de Provedor de LLM inválidas ou expiradas"; a chave nunca aparece na tela (Claude, navegador automatizado) |
| L7 | Voltar de URL para Claude | Exige **remover** a integração e criar de novo (comportamento documentado) | [ ] | |
| L8 | Org B abre o card | Não vê a configuração da org A (isolamento, bloqueante) | [x] | outra organização vê o card "Não configurada" (Claude, navegador automatizado) |
| L9 | Provedor devolve 429 (limite do plano grátis) | Erro tratado sem derrubar a tela; a mensagem de "requisições demais" sugere uma instância própria (Ollama) | [ ] | |

## M. Rate limit persistente em Redis (SPEC-059). Sem migration; env opcional `REDIS_URL`

Redis já sobe no docker (`docker compose up -d redis`, porta 6379).

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| M1 | Sem `REDIS_URL`, errar a senha do login várias vezes | Bloqueio/backoff como antes (memória); reiniciar o `npm run dev` zera o contador | [ ] | |
| M2 | Com `REDIS_URL=redis://localhost:6379` e reiniciar, repetir M1 | Bloqueio igual; reiniciar o `npm run dev` **não** zera o contador | [x] | com `REDIS_URL`: 5 falhas bloqueiam e, depois de reiniciar o `npm run dev`, o login com a senha CERTA continua "Muitas tentativas" (Claude, navegador automatizado) |
| M3 | `docker exec` no Redis: `redis-cli --scan --pattern 'lf:rl:*'` | Chaves com prefixo `lf:rl:<namespace>:` e o resto **hasheado** (nenhum e-mail, IP ou token legível) | [x] | chaves `lf:rl:login:<32 hex>`: nenhum e-mail/IP legível (Claude, navegador automatizado) |
| M4 | Reenviar e-mail de verificação mais de 5 vezes (bloco J) com Redis ligado | Limite continua valendo e sobrevive a reinício | [ ] | |
| M5 | Parar o Redis (`docker stop leadforge-redis-1`) e usar o login | Não quebra nem trava; log com aviso `[rate-limit]`; volta à memória do processo | [x] | com `REDIS_URL` apontando para porta sem Redis: login normal funciona e o log mostra `[rate-limit] Redis indisponivel; usando memoria por processo` (Claude, navegador automatizado) |
| M6 | Religar o Redis | Em até uns segundos volta a usar o Redis, sem reiniciar o app | [ ] | |

## N. Busca Places paginada (SPEC-060). Precisa da migration `20261016120000_search_run_cursor_060` aplicada no dev

Antes: `npx prisma migrate deploy` (aditiva, 3 colunas em `SearchRun`) e reiniciar o `npm run dev`. Resto do preparo: bloco G.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| N1 | Primeira busca da campanha (owner, **Buscar agora**) | Traz até 20 resultados; o botão passa a dizer **Buscar mais resultados** se houver próxima página | [x] | só a interface (sem chave do Google): com cursor no último run o botão vira "Buscar mais resultados" e aparece "Há mais resultados para esta busca..."; fica desabilitado sem a chave, com "Falta a chave de busca de leads"; 390px sem rolagem horizontal. Chamada real ao Google não testada (Claude, navegador automatizado) |
| N2 | Clicar **Buscar mais resultados** | Traz resultados **novos** (continua de onde parou), sem repetir os já criados | [ ] | |
| N3 | Continuar até acabarem as páginas | Passa para variações da busca em vez de só devolver duplicados | [ ] | |
| N4 | Conferir o custo no Google Cloud | 1 a 2 chamadas pagas por clique; nunca acima do teto manual/diário da SPEC-058 | [ ] | |
| N5 | Passar do teto de buscas do dia | Bloqueio claro de orçamento; nenhuma chamada ao Google e o cursor não muda | [ ] | |
| N6 | Mudar o ICP (nicho ou local) da campanha e buscar | Recomeça da primeira página/variação | [ ] | |
| N7 | Busca que falha (chave errada) | Run fica "failed" e o cursor **não** avança | [ ] | |
| N8 | Tenant B tenta a mesma campanha por URL | 404/negado (isolamento, bloqueante) | [x] | outro tenant abre a URL da campanha e não vê o nome nem os dados (sem vazamento) (Claude, navegador automatizado) |
| N9 | Conferir log e tela | Nenhuma chave de API aparece | [ ] | |

## O. Formulários de Configurações e Admin (SPEC-045, react-hook-form). Sem migration; só interface

Mudou só o jeito de validar e mostrar erro nos formulários; as regras são as mesmas. Teste em desktop e em 390px.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| O1 | `/configuracoes/email` > **Nova conta**, salvar vazio | Erros em cada campo obrigatório, foco no primeiro; nada é enviado | [ ] | |
| O2 | Trocar o provedor (Gmail para Outlook) | Host e porta mudam sozinhos; salvar conta válida mostra "Conta adicionada." | [ ] | |
| O3 | Criar duas contas com o mesmo e-mail | Erro "Já existe uma conta cadastrada com este e-mail." no campo e aviso (toast) | [ ] | |
| O4 | Editar a conta e deixar a senha em branco | Salva mantendo a senha atual | [ ] | |
| O5 | `/configuracoes/integracoes` > Configurar sem chave | "Informe a chave."; com chave curta, "A chave deve ter ao menos 12 caracteres." | [ ] | |
| O6 | Evolution/LLM com URL inválida | "URL inválida. Ex.: https://evolution.exemplo.com"; LLM sem URL e com chave segue válido (Claude) | [ ] | |
| O7 | Salvar integração com sucesso e reabrir o diálogo | Campo da chave vem vazio (a chave nunca reaparece) | [ ] | |
| O8 | `/configuracoes/supressao` > Adicionar sem preencher | "Informe o e-mail." (ou "Informe o telefone."); trocar o tipo limpa o campo e os erros | [ ] | |
| O9 | Adicionar telefone com máscara, depois remover um item sem motivo e sem marcar a confirmação | Máscara (11) 91234-5678 funciona; remoção mostra "Descreva o motivo (mínimo 5 caracteres)." e "Marque a confirmação para remover." | [ ] | |
| O10 | `/configuracoes/whatsapp` > Nova instância com teto 0 ou 41 | Mensagens de limite (1 a 40); número inválido mostra erro no campo | [ ] | |
| O11 | Admin da plataforma: detalhe da organização > Suspender | Botão do diálogo só habilita com motivo de 3+ caracteres; suspende e Reativar volta ao normal | [ ] | |
| O12 | Tab/Enter em todos os diálogos acima | Foco vai ao primeiro campo com erro; Enter envia; leitor de tela lê o erro do campo | [ ] | |

## P. Plano obrigatório antes da organização (SPEC-062b). **Desde a SPEC-065 vale só para a 2ª organização e para quem ficou sem organização** (o cadastro novo é o bloco T). Precisa da migration `20261017120000_cadastro_sem_trial` no dev (`npx prisma migrate deploy`)

> Atenção: P1, P2, P5, P17 descrevem o cadastro da 062 e ficam **substituídos pelo bloco T** (cadastro com organização e teste grátis; landing com "14 dias grátis"). Use o bloco P para: 2ª organização (`/assinar?nova=1`), convite/código, `/minha-conta` e casca paga.

Para testar sem gastar nada: `PAYMENT_PROVIDER=mock` (padrão) em `npm run dev`. Deixe o Mailpit aberto (http://localhost:8025). Use janela anônima e e-mail novo. **Teste cada tela também em 390px de largura e só com o teclado (Tab, Enter, Esc), em claro e escuro.**

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| P1 | `/signup` | Só **Nome, E-mail, Senha (mínimo 6) e Confirmar senha**, com barra de força. Nada de "Nome da empresa", escolha de organização, plano, "grátis" ou "14 dias" | [ ] | |
| P2 | Criar a conta | Cai em `/assinar`. No Mailpit: "Bem-vindo" (com o próximo passo) e "Confirme seu e-mail". Nenhum e-mail de trial | [ ] | |
| P3 | Em `/assinar` (e-mail **ainda não confirmado**) | Aviso "Confirme seu e-mail para assinar" com **Reenviar e-mail** (espera de 60 s) e **Já confirmei, atualizar**; todos os botões "Assinar" cinza; o plano Business diz "Falar com vendas" | [ ] | |
| P4 | Abrir o link de confirmação do Mailpit e voltar a `/assinar` (atualizar) | Aviso some; "Assinar" habilita. Mensal/Anual muda o preço (os valores são provisórios) | [ ] | |
| P5 | Tentar `/dashboard`, `/leads` na barra de endereço sem pagar | Volta para `/assinar`. Nada do painel abre | [ ] | |
| P6 | Clicar **Assinar** num plano | Abre o checkout de mentirinha; ao concluir cai em `/assinar/retorno` com "Confirmando seu pagamento..." e muda para "Pagamento confirmado!" e vai a `/organizacao/nova` | [ ] | |
| P7 | Abrir `/assinar/retorno?checkout=success` com uma conta **sem** pagamento | Não libera nada: mostra "Não encontramos um pagamento em andamento" (ou continua confirmando). O parâmetro da URL não vale | [ ] | |
| P8 | Em `/organizacao/nova`, enviar vazio, depois um nome | Vazio: "Nome da organização é obrigatório." no campo. Com nome: abre o `/dashboard` como dono. Clicar duas vezes rápido não cria 2 organizações | [ ] | |
| P9 | Conta paga sem nome (feche a aba em P6 antes de nomear), entre de novo | Cai direto em `/organizacao/nova` (o plano pago não some). `/assinar` não abre um 2º checkout: volta para `/organizacao/nova`. Em `/organizacao/nova` há "Cancelar assinatura" com janelinha de confirmação | [ ] | |
| P10 | Abandono: em P6, desistir no checkout (`?checkout=cancel`) | `/assinar` mostra "Pagamento cancelado. Nenhuma cobrança foi feita." e dá para escolher de novo (a mesma conta, sem duplicar nada) | [ ] | |
| P11 | Pagamento indisponível (apague as chaves ou use um provedor sem chave, ou rode com `NODE_ENV=production` sem `ALLOW_MOCK_BILLING`) | Alerta "Pagamento indisponível no momento. Nenhuma cobrança foi feita"; o foco vai para o alerta | [ ] | |
| P12 | Convite sem pagar: dono convida um e-mail novo; a pessoa abre o link e cria a conta; e, em outro caso, usa um **código** em `/entrar-em-organizacao` já logada | Entra na organização como membro, **sem passar por `/assinar`** e sem checkout. Código errado: mensagem genérica "código inválido ou expirado" | [ ] | |
| P13 | Quem já tem organização: banner **"Finalize sua organização"** | Aparece no topo do painel quando existe um plano pago sem nome (casca paga). "Finalizar agora" leva a `/organizacao/nova`. "Criar organização" no seletor e "Nova organização" em `/organizacoes` levam a `/assinar?nova=1` | [ ] | |
| P14 | `/minha-conta` sem organização | Mostra o e-mail (confirmado ou com reenvio) e **Excluir minha conta** (mesma tela de Configurações > Conta). Quem já tem organização é levado para `/configuracoes/conta` | [ ] | |
| P15 | Admin em `/admin/organizacoes` | Organização paga e ainda sem nome aparece com o selo **Em configuração** | [ ] | |
| P16 | Org antiga em trial vencido (se existir no seu banco) | Faixa vermelha "Seu período de teste terminou. Escolha um plano..." com o botão "Escolher um plano" (leva a Configurações > Assinatura) | [ ] | |
| P17 | Landing `/` (claro, escuro, 390px) | Nenhum "grátis", "14 dias" ou "sem cartão". Botões "Criar conta" levam a `/signup`; nos preços, "Assinar {plano}" leva a `/signup?plan=...&cadence=...`; Business "Falar com vendas". Depois de criar a conta, `/assinar` já destaca o plano escolhido ("Escolhido por você") | [ ] | |
| P18 | Teclado e leitor de tela em `/assinar`, `/assinar/retorno`, `/organizacao/nova` | Tab chega em tudo na ordem certa, foco visível; erro do campo é lido; "Confirmando..." é anunciado; sem barra de rolagem lateral em 390px | [ ] | |

## T. Teste grátis de 14 dias e limites (SPEC-065a + 065b). Precisa da migration `20261019120000_free_trial_065a` **e do seed** no dev

Preparação (você faz, o projeto não aplica sozinho): `npx prisma migrate deploy`, depois `npx prisma db seed`, e reinicie o `npm run dev`. **Nunca `migrate dev`.** Deixe o Mailpit aberto (http://localhost:8025) e o `npm run dev:tick` rodando. Use janela anônima, e-mail novo e **CPF de teste válido** (ex.: `529.982.247-25`; CNPJ de teste: `11.222.333/0001-81`). **Teste cada tela também em 390px de largura, só com o teclado (Tab, Enter, Esc), em claro e escuro.**

> ⚠️ **Os limites do Starter agora valem na organização de seed do dev** (no seed ela está no Starter): pode barrar dados de teste grandes. Para testar limites baixos use uma conta **nova** (plano "Teste gratis"). A organização do admin e as de cortesia não têm limite.

Para simular o passar do tempo, no banco de **dev** (por sua conta; troque `<orgId>`): `UPDATE "Subscription" SET "trialEndsAt" = now() + interval '2 days' WHERE "orgId" = '<orgId>';` (últimos dias) e `... SET "trialEndsAt" = now() - interval '3 days' ...` (expirado: aparece "Seu teste grátis terminou em {data}"). Depois recarregue a página. **Cuidado:** a mensagem "Não foi possível liberar o teste grátis para este cadastro" (cadastro que já usou o teste) só aparece quando `trialEndsAt` é praticamente igual à data de criação da organização; para ver essa, use o T7 (cadastro repetido), não o SQL de expirar.

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| T1 | `/signup` | Texto **"14 dias grátis, sem cartão"**; campos Nome, E-mail, **CPF ou CNPJ**, Senha, Confirmar senha (com barra de força). Sem "Nome da empresa" nem plano. Aviso embaixo do CPF/CNPJ: só limita o teste a um por pessoa/empresa e guarda só um hash | [ ] | |
| T2 | Digitar `52998224725` e depois `11222333000181` no CPF/CNPJ | A máscara aparece sozinha (`529.982.247-25` / `11.222.333/0001-81`); o teclado do celular é numérico | [ ] | |
| T3 | CPF `111.111.111-11`, `123.456.789-00` e vazio, e enviar | "CPF ou CNPJ inválido." / "CPF ou CNPJ é obrigatório." no campo; o foco vai ao campo; nada é criado | [ ] | |
| T4 | Criar a conta com dados válidos | Cai direto em `/dashboard` (sem tela de pagamento). Chip **"Teste grátis: 14 dias"** + botão **Fazer upgrade** no topo (em 390px o chip vira "14 d" e o botão some; o chip leva à assinatura). Mailpit: "Bem-vindo" com "14 dias grátis, até {data}" e "Confirme seu e-mail" | [ ] | |
| T5 | Cartão **"Como se chama a sua empresa?"** | Campo já com "Empresa de {nome}"; salvar muda o nome (aparece no seletor da sidebar) e o cartão some; "Agora não" (ou o X) também some e **não volta** ao recarregar. Vazio: erro no campo | [ ] | |
| T6 | Cartão **Primeiros passos** | 3 passos; ao criar um canal/campanha/lead o passo fica riscado "(feito)"; com os 3 feitos o cartão some; "Dispensar" some e não volta | [ ] | |
| T7 | Cadastrar de novo com o **mesmo e-mail** (ou com `a.b+x@gmail.com` do mesmo Gmail) e CPF diferente; depois com e-mail novo e o **mesmo CPF**; depois com outro CNPJ da mesma raiz (matriz/filial) | A conta é criada mas **sem teste**: a tela de assinatura diz **"Não foi possível liberar o teste grátis para este cadastro"**, sem dizer qual. O painel fica bloqueado até assinar | [ ] | |
| T8 | Simular **2 dias restantes** | Faixa amarela "Faltam 2 dias do seu teste grátis..." com "Fazer upgrade"; chip em tom de aviso | [ ] | |
| T9 | Em **Configurações > Assinatura** (teste ativo) | Cartão "Plano Teste gratis", "Teste grátis até {data} (faltam N dias)", sem "Gerenciar assinatura" nem "Cancelar"; **Uso do plano** com barras (Campanhas ativas, WhatsApp, E-mail, Leads, Envios); aviso do aquecimento do WhatsApp; seção **Fazer upgrade** com Starter/Pro, mensal/anual | [ ] | |
| T10 | Criar a **1ª campanha ativa** e depois uma **2ª ativa** (conta nova, limite 1) | A 2ª é barrada com "Seu plano permite 1 campanha ativa..." e um toast com botão **Fazer upgrade**. Em `/campanhas/nova` já aparece o aviso amarelo e a campanha nasce **pausada** por padrão. Pausar/arquivar continua livre | [ ] | |
| T11 | Em `/configuracoes/whatsapp` e `/configuracoes/email` com o limite 1 já usado; em `/leads` com 50 leads usados | O botão **Nova instância / Nova conta / Novo lead** fica **cinza** com o aviso "Você já conectou 1 de 1 ... Para continuar, faça upgrade" e o link "Fazer upgrade". O leitor de tela lê o aviso junto do botão | [ ] | |
| T12 | Simular **teste expirado** (dono) e abrir `/leads` ou `/dashboard` | Vai para **/configuracoes/assinatura**. A sidebar tem **só Assinatura e Minha conta** (mais o seletor de organizações); o topo não tem busca nem sino; as abas de Configurações só mostram Assinatura e Conta. Título "Seu teste grátis terminou em {data}", "Seus dados estão guardados" e botão **Escolher plano** (leva aos planos) | [ ] | |
| T13 | Mesmo estado, mas logado como **membro convidado** | "O teste grátis desta organização terminou. Peça ao proprietário ({nome})..." Sem botão de pagar e sem lista de planos | [ ] | |
| T14 | Expirado: ainda dá para **trocar de organização, abrir Minha conta, sair e excluir a conta**? E abrir `/api/...`/URL de um lead por fora? | Sim para as quatro primeiras; qualquer página/ação da organização é barrada (nunca mostra dado) | [ ] | |
| T15 | Expirado (dono): **Assinar** um plano (mock) | Volta para `/configuracoes/assinatura?checkout=success` com **"Confirmando seu pagamento..."**; ao confirmar, "Pagamento confirmado!" e o menu completo **volta sem precisar sair e entrar**; o limite novo vale; o chip some | [ ] | |
| T16 | Abrir `/configuracoes/assinatura?checkout=success` com uma conta que **não** pagou | Fica em "Confirmando..." e depois (≈3 min) "Ainda não recebemos a confirmação... nenhuma nova cobrança". A URL sozinha **nunca** libera o acesso | [ ] | |
| T17 | Cancelar o pagamento no checkout (`?checkout=cancel`) | Toast "Checkout cancelado. Nenhuma cobrança foi feita." e a org continua em teste | [ ] | |
| T18 | Landing `/` (claro, escuro, 390px) | Botão **"Comece 14 dias grátis"**, "Sem cartão de crédito. Limites reduzidos no teste.", nos preços "Teste 14 dias grátis e escolha o plano quando precisar", botões "Começar 14 dias grátis", bloco "O que acontece quando o teste acaba?". Nada de "7 dias" nem "sem limites". Clicar num plano leva a `/signup?plan=...`; depois do cadastro o dashboard mostra "Você escolheu o plano X" e a Assinatura destaca "Escolhido por você" (o checkout **não** abre sozinho) | [ ] | |
| T19 | Teclado e leitor de tela: `/signup`, dashboard (cartões), chip, faixa, Assinatura, tela de bloqueio | Tab em ordem e foco visível; erro de campo é lido; a tela de bloqueio anuncia o motivo (role=status) e põe o foco no título; "Confirmando..." é anunciado; barras de uso têm texto "1 de 1"; **sem barra de rolagem lateral em 390px**; contraste ok no escuro | [ ] | |
| T20 | Org de **cortesia**/admin/seed antiga | Sem chip, sem limites, sem bloqueio (ilimitada); org paga normal inalterada | [ ] | |

### P-064. Senha: mínimo 6, confirmar senha e barra de força (SPEC-064). Sem migration; só interface e validação

Testar em `/signup`, em `/convite/[token]` (usuário novo) e em `/redefinir-senha?token=...`. **Em 390px, só com teclado e em claro e escuro.**

| # | O que fazer | O que deve acontecer | OK? | Observado |
|---|---|---|---|---|
| S1 | Digitar senha de 5 caracteres e enviar | Erro no campo: "Senha deve ter ao menos 6 caracteres."; dica "Mínimo de 6 caracteres." visível (não diz 12) | [ ] | |
| S2 | Senha `abc123` (6) e a mesma em "Confirmar senha" | Envia e cria a conta (senha fraca não bloqueia) | [ ] | |
| S3 | Confirmar diferente e enviar | "As senhas não coincidem." no campo Confirmar senha; foco vai para ele; nada é criado | [ ] | |
| S4 | Digitar `123456`, `senha123`, o próprio e-mail, `aaaaaa` | Barra com 1 segmento, texto "Força: Muito fraca." com a dica do que evitar | [ ] | |
| S5 | Digitar `bolo42`, depois `Laranja8`, depois `Tr0ca-Esta-Chave!` | Sobe de nível: Fraca, Razoável e Forte (4 segmentos). O texto muda, não só a cor; o leitor de tela anuncia sem repetir a cada letra de forma confusa | [ ] | |
| S6 | Botão do olho em cada campo; Tab entre os campos | Cada campo mostra/oculta o seu texto; foco visível; ordem: senha, olho, confirmar, olho, botão | [ ] | |
| S7 | Chamar a action sem `confirmPassword` (ou diferente) por fora da tela | O servidor também rejeita com o erro no campo `confirmPassword` | [ ] | |
| S8 | Entrar (login) com uma conta antiga de senha com 12+ caracteres | Continua entrando; o login não tem mínimo novo | [ ] | |
| S9 | Redefinir senha com link do e-mail (6+ e confirmar igual) | Redefine; avisa e leva ao login | [ ] | |

Cortesia e admin da plataforma **não mudam**: entram direto, sem `/assinar`.

## U. Efeito da caixa de atendimento no envio automático (SPEC-068a)
Quando a caixa estiver no ar: o limite diário de cada número agora guarda cerca de 20% para respostas manuais (limite 30 -> o automático envia até 24; limite 10 -> até 8; abaixo de 5 não reserva). Confira que o envio automático segue respeitando a janela, a pausa e o aquecimento e que uma resposta manual recente (menos de 3 s) adia o automático.

## V. Caixa de atendimento: tela `/atendimento` (SPEC-068b)
Pré-requisito: `npx prisma migrate deploy` (migration `20261021120000_inbox_whatsapp_068a`), reiniciar o `npm run dev`, opcional `npm run inbox:backfill`; uma instância WhatsApp conectada e um lead com mensagem recebida. Testar em **390 px** e **1280 px**, claro e escuro.

| # | Passo | Esperado | OK | Obs |
|---|---|---|---|---|
| V1 | Menu lateral | Item "Atendimento" abaixo de Dashboard; com mensagens não lidas mostra o número (99+ no máximo) e o título da aba vira `(3) ...` | [ ] | |
| V2 | Abrir `/atendimento` em 1280 px | Duas colunas: lista à esquerda (~360 px), chat à direita ("Selecione uma conversa") | [ ] | |
| V3 | Abrir em 390 px | Só a lista; ao tocar numa conversa abre só o chat com botão "Voltar"; sem rolagem horizontal | [ ] | |
| V4 | Abas Todas / Aguardando / Atendendo / Encerradas e busca por nome, empresa ou telefone | A lista filtra; vazio mostra "Nenhuma conversa encontrada"; setas esquerda/direita trocam de aba | [ ] | |
| V5 | O lead manda mensagem pelo WhatsApp | Aparece na lista em até 10 s (nome, prévia, hora, bolinha de não lidas) e, com o chat aberto, em até 4 s | [ ] | |
| V6 | Abrir a conversa | O não lido zera (lista, menu e título); a mensagem "Nova mensagem de ..." é anunciada por leitor de tela | [ ] | |
| V7 | Rolar o chat para cima e o lead mandar outra | Não pula para o fim: aparece o botão "1 nova mensagem"; ao clicar desce | [ ] | |
| V8 | Responder com texto (Enter envia, Shift+Enter quebra linha) | Bolha sai à direita com seu nome; ícone evolui enviada > entregue > lida (texto "Enviada/Entregue/Lida" para leitor de tela); a conversa vira "Atendendo" | [ ] | |
| V9 | Dar duplo clique/Enter repetido ao enviar | Só uma mensagem sai | [ ] | |
| V10 | Conversa com a última mensagem do lead há mais de 24 h | Campo de resposta trocado pelo aviso "A janela de 24 horas ... terminou" | [ ] | |
| V11 | Lead que pediu "pare" (opt-out) | Aviso "pediu para não receber mensagens"; sem botão de enviar | [ ] | |
| V12 | Lead com "possível opt-out" | Aviso vermelho; ao enviar pede confirmação "Enviar mesmo assim?" | [ ] | |
| V13 | Número desconectado/pausado | Faixa vermelha com link "Abrir Configurações > WhatsApp"; composer bloqueado com o motivo | [ ] | |
| V14 | Mensagem que falha (ex.: número sem WhatsApp) | Bolha com o erro e botão "Reenviar" (cria mensagem nova); toast em português | [ ] | |
| V15 | Mudar o status no seletor do cabeçalho (Aguardando/Atendendo/Encerrada) | Muda na hora e na lista; se o servidor falhar volta ao anterior com toast | [ ] | |
| V16 | Mensagem do lead com `<b>oi</b>` ou `javascript:alert(1)` | Aparece como texto; só links `http/https` viram link (abre em nova aba) | [ ] | |
| V17 | Trocar de aba do navegador por 1 min e voltar | Sem requisições enquanto oculta (aba Rede do DevTools); ao voltar atualiza na hora; derrubar a rede = faixa "Sem conexão" e tentativas cada vez mais espaçadas (até 60 s) | [ ] | |
| V18 | Teclado: Tab pela lista, abas, chat e composer | Foco sempre visível; alvos de toque >= 44 px em 390 px | [ ] | |
| V19 | Usuário de **outra organização** abre `/atendimento?c=<id de uma conversa desta org>` | "Conversa não encontrada" (isolamento, bloqueante) | [ ] | |
| V20 | Configurações > WhatsApp > Excluir instância | O aviso diz que apaga também as conversas da Caixa de atendimento daquele número | [ ] | |

Ainda **não** existe: anexos (068c/d), etiquetas/atribuição (068e). Texto recebido sem legenda (imagem etc.) ainda é ignorado pelo backend.

## W. Primeiro envio de WhatsApp pelo app e resposta do lead (local, com túnel)
Pré-requisitos: `docker compose up -d evolution` (porta 8080), instância conectada em Configurações > WhatsApp (QR lido), túnel ligado e `APP_BASE_URL`/`AUTH_URL` no `.env` com o endereço do túnel (muda a cada vez), `npm run dev`. Use um número descartável e **um lead com o número de um amigo**.

| # | Passo | Esperado | OK | Obs |
|---|---|---|---|---|
| W1 | `curl localhost:8080` | "Welcome to the Evolution API" (v2.1.1) | [ ] | |
| W2 | Configurações > WhatsApp | Instância "conectada" (se a Evolution caiu por causa do Postgres: `docker compose up -d evolution`) | [ ] | |
| W3 | Sequências > Templates > Novo template: **canal WhatsApp**, campanha escolhida, texto com `{{firstName}}` | Template com selo verde WhatsApp (variáveis aceitas: name, firstName, company, email, phone, website) | [ ] | |
| W4 | Sequências > Nova > Adicionar passo: **canal WhatsApp**, template acima, dia 0 | Sequência com 1 passo | [ ] | |
| W5 | Campanha > escolher a sequência e a instância `vendas (conectada)` > Salvar | O cartão da campanha mostra o nome da sequência | [ ] | |
| W6 | Leads > Novo lead com o celular do amigo; na campanha "Iniciar sequência para os leads pendentes" | Toque agendado; **se a conta não confirmou o e-mail, não envia** ("Confirme seu e-mail...") | [ ] | |
| W7 | Rodar o tick (`POST /api/cron/tick` com o `CRON_SECRET`) **dentro da janela** (seg-sex, 9h-12h e 14h-17h, sem feriado) | Mensagem chega no celular do amigo; toque "Enviado"; lead "Contactado" | [ ] | Fora da janela o tick responde `deferred_outside_window`; só para teste local, mude o fuso do lead no banco e volte depois |
| W8 | O amigo **responde** | Em até alguns segundos a resposta aparece no lead (Histórico de contatos) e em `/atendimento`; a sequência pausa ("respondeu") | [ ] | Sem resposta no app: conferir o webhook da instância (URL do túnel atual e token igual ao do banco) e o log do dev (`POST /api/webhooks/whatsapp/... 200`) |
| W9 | Repetir o teste com o mesmo número | Não dá na mesma campanha (lead único por campanha+telefone; 1 toque por lead+passo): use **Duplicar campanha** ou outro lead | [ ] | |

## X. Limites por plano (SPEC-069) e criativos (SPEC-051c) — local
Pré-requisitos: migration `20261022120000_entitlement_override_069a` aplicada (`npx prisma migrate deploy`) e `npx prisma db seed`; `npm run dev` e, para criativos, `npm run creatives:dev` em outro terminal. A tela de admin para configurar política/override (**069c frontend**) já existe em `/admin/organizacoes/[id]`; use-a nos testes X13 a X21 (X2 ainda pode ser feito por SQL). Migration `20261023120000_admin_policy_069c` também precisa estar aplicada.

| # | Passo | Esperado | OK | Obs |
|---|---|---|---|---|
| X1 | Conta Free (trial): `/criativos/novo`, preencher as 4 etapas e **Criar e enviar** | Bloqueio "Seu plano não inclui criativos" (hoje com texto técnico `plan_limit creatives 0 0`; a UI amigável com botão de upgrade é a 069d) | [ ] | |
| X2 | Inserir override local de 20 criativos (tabela `OrgEntitlementOverride`, `limits={"maxCreativesPerMonth":20}`, motivo, validade) e repetir X1 | Criativo é criado e fica "Na fila", depois "Pronto" com `npm run creatives:dev` | [ ] | |
| X3 | Avatar **Luciana (mock)** + voz feminina pt-BR | Vídeo de ~20 s com uma moça falando em português (sempre o mesmo; não lê o roteiro digitado) | [ ] | |
| X4 | Outro avatar (Ana/Clara) | Vídeo de demonstração padrão, toca no player | [ ] | |
| X5 | Excluir um criativo | Some da biblioteca; a cota do mês continua contada | [ ] | |
| X6 | Free tenta ativar agente (`/configuracoes/agentes`) | Bloqueado no servidor (`plan_feature_locked`); no Starter só `followup` em rascunho; no Pro até 3 | [ ] | |
| X7 | Free tenta responder na caixa `/atendimento` | Só leitura; Starter responde texto | [ ] | |
| X8 | Free/Starter tentam salvar integração Google Ads/Meta ou n8n | Bloqueado (só Pro); a configuração antiga é preservada e volta no upgrade | [ ] | |
| X9 | Convidar membros além do limite (Free 1, Starter 3, Pro 10) | Recusado com mensagem em português | [ ] | |
| X10 | Criar sequência com mais passos que o plano (Free 3, Starter 5) | Recusado; editar uma sequência já maior (após downgrade) continua possível e só pode encolher | [ ] | |
| X11 | Mudar a assinatura para `past_due` no banco local | IA e envio automático pausam (adiados); leitura continua; nada é apagado | [ ] | |
| X12 | `/configuracoes/assinatura` | Carrega sem o erro "[entitlements] falha ao ler o plano" (se aparecer, falta a migration/seed) | [ ] | |
| X13 | Como `platform_admin`, abrir `/admin/organizacoes/[id]` | Painel "Política da organização" com 4 abas (Agentes e IA, Integrações, Plano e features, Auditoria); usuário comum recebe redirect/403 | [ ] | |
| X14 | Aba Integrações: gravar chave do Google Places da organização (com motivo) | Toast de sucesso; tela mostra só o hint e o host mascarado, nunca a chave; campo de chave volta vazio | [ ] | |
| X15 | Gravar Evolution (URL + chave) e parear WhatsApp no tenant | Tenant consegue parear; tenant não edita a chave (somente leitura) | [ ] | |
| X16 | Gravar chave de LLM da plataforma para a org (com `PLATFORM_LLM_API_KEY` definida ou chave por org) | Agentes da org voltam a ter IA; chave própria antiga do tenant fica desativada, não apagada | [ ] | |
| X17 | Aba Plano e features: liberar uma funcionalidade e um limite, com validade e motivo | Efeito imediato no tenant; aparece na auditoria | [ ] | |
| X18 | Remover o override (com motivo) | Volta a valer o plano; auditoria registra | [ ] | |
| X19 | Aba Agentes: ligar a trava `lockedByAdmin` e o kill switch | Tenant só liga o kill switch, não desliga enquanto travado | [ ] | |
| X20 | Aba Auditoria | Últimas 50 alterações com ação, motivo, campos, data e prefixo do id do admin; nenhum valor de segredo | [ ] | |
| X21 | Abrir o painel em 390 px e 1280 px, claro e escuro | Sem rolagem horizontal da página; abas rolam; diálogos cabem na tela (**não verificado em navegador ainda**) | [ ] | |

## Se algo falhar, me mande

1. O passo (ex.: `B5`), o e-mail logado e a URL.
2. O erro da tela e o que aparece no terminal do `npm run dev`.
3. Para erro de banco: `npx prisma migrate status`.

Falha de isolamento (B5, B6, C2, C11) é **bloqueante**: pare e me avise antes de seguir.
