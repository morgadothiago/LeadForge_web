# Primeiros passos: fazer o LeadForge funcionar (versão para criança de 5 anos)

Este guia é um passo a passo. Marque cada item ✅ quando terminar. Em cada passo tem o comando, **o que você deve
ver na tela** e como conferir.

Ele ajuda os outros guias: `docs/GUIA.md` (o livro completo), `docs/CONFIGURACAO_POS_PROJETO.md` (o que arrumar depois
de cada SPEC) e `docs/ROTEIRO_DE_TESTES.md` (o que clicar e o que esperar).
Revisado contra o código em 2026-10-11. Onde estiver escrito "não verificado", ninguém testou no navegador ou
no serviço de verdade: só se leu o código e rodaram testes automáticos.

---

## O que é o LeadForge?

Imagine uma lojinha que precisa de clientes. Ela não sabe onde achá-los. O LeadForge é o ajudante dessa lojinha.

Ele procura pessoas e empresas que podem comprar (a gente chama de **lead**: um "possível cliente"). Depois ele
conversa com elas por você e organiza tudo num quadro. Assim você não se perde.

### O que dá para fazer

- 🔎 **Achar clientes:** buscar empresas no Google Maps (nome, telefone, site, endereço).
- 💬 **Mandar mensagens:** falar com os clientes pelo WhatsApp e por e-mail, em sequência.
- 🎬 **Criar vídeos e criativos:** fazer vídeos de apresentação com avatar (hoje é de mentirinha, só para testar).
- 👨‍👩‍👧 **Organizações com várias pessoas:** como uma sala de aula. Cada organização é uma sala, e você convida
  amigos para entrar.
- 💳 **Planos e cobrança:** planos como "pequeno" e "grande", teste grátis (trial) e cobrança.
- 📧 **E-mails automáticos:** o sistema avisa sozinho: "bem-vindo", "pagamento falhou", "recibo", "convite".

### Palavras que vão aparecer (o dicionário rápido)

- **Docker:** uma caixinha mágica onde os programas moram, para não bagunçar o seu computador.
- **Postgres:** o armário gigante onde o LeadForge guarda tudo (o banco de dados).
- **Redis:** um bloquinho de recados rápidos, que o sistema usa para lembrar de coisas por pouco tempo.
- **Migration:** arrumar as gavetas do armário. Cada migration é uma ordem do tipo "crie uma gaveta nova".
- **Seed:** colocar brinquedos de exemplo no armário vazio, para você ter o que ver.
- **`.env`:** um caderninho de segredos. Tem senhas e chaves. Nunca mostre para ninguém.
- **Tick:** um despertador que acorda o sistema a cada minuto para ele fazer as tarefas atrasadas.
- **Webhook:** o carteiro. Ele bate na porta para avisar "o pagamento chegou!".
- **Mock:** de mentirinha. É um brinquedo que faz de conta que é de verdade. Não gasta dinheiro.
- **Mailpit:** uma caixa de correio de brinquedo. Os e-mails chegam nela e não saem do seu computador.
- **SPEC:** a receita de uma funcionalidade, escrita antes de fazer.
- **Provider (provedor):** o "fornecedor" de um serviço, tipo quem entrega o pagamento ou o e-mail.

---

## Como está o seu ambiente hoje (só nomes, nunca valores)

- O caderninho `.env` já tem: `POSTGRES_PASSWORD`, `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD`, `ENCRYPTION_KEY`, `CRON_SECRET`, `INGEST_SECRET`, `N8N_ENCRYPTION_KEY`, `EVOLUTION_*` e `SMTP_*`.
- Faltam, mas **todas são opcionais**:
  - `REDIS_URL` (faz o limite de tentativas lembrar mesmo se o app reiniciar; veja 2.9)
  - `RESEND_API_KEY`
  - `APP_BASE_URL` (os links dos e-mails usam `AUTH_URL` e, se faltar, `http://localhost:3000`; em produção, defina)
  - qualquer chave de LLM (o "cérebro" que escreve mensagens)
- Ausentes de propósito: `LEAD_SEARCH_ENABLED` (a busca de leads está desligada), `CREATIVE_*` e `STORAGE_*`.
- 📬 **O e-mail já vai para o Mailpit:** `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true`. A caixa
  fica em http://localhost:8025. Nada sai para a internet.
- 🗄️ **Migrations (gavetas):** são 43 no projeto. A última é `20261016120000_search_run_cursor_060` (SPEC-060: dá à busca de
  clientes uma "memória" de onde parou, com 3 colunas novas).
  - ⚠️ No banco de dev, tudo até `20261015120000_email_verification` já está aplicado (conferido com
    `npx prisma migrate status` em 2026-10-11). **Falta só a `20261016120000_search_run_cursor_060`.** Rode `npx prisma migrate deploy`
    e depois pare e ligue o `npm run dev` de novo.
  - Em outro computador ou banco novo, aplique tudo com `npx prisma migrate deploy` (passo 1.3).
- 🐳 **Caixinhas no ar:** `leadforge-postgres-1`, `leadforge-redis-1` e `mailpit`. O `evolution` e o `n8n` não.
- 💳 `PAYMENT_PROVIDER` não está definido. Tudo bem: o padrão `mock` (de mentirinha) já basta.

---

## Fase 1: o app abre e você entra (obrigatório)

### 1.1 Ligar o Docker

Docker é a caixinha mágica. Sem ela ligada, nada mais funciona. No Mac com Colima:

```bash
colima start
```

- **O que você deve ver na tela:** várias linhas de "starting..." e, no fim, "done".
- Como conferir: `docker ps` não dá erro (pode aparecer uma lista vazia, e isso é normal).

### 1.2 Ligar o armário (Postgres) e o bloquinho (Redis)

```bash
docker compose up -d postgres redis
```

- **O que você deve ver na tela:** "Started" ou "Running" para `postgres` e `redis`.
- Como conferir: `docker ps` mostra `leadforge-postgres-1` e `leadforge-redis-1`.
- ⚠️ Se esquecer este passo, a página `/` dá erro **500** (a página inicial lê os planos no armário).

### 1.3 Arrumar as gavetas (migrations)

```bash
npx prisma migrate deploy
```

- **O que você deve ver na tela:** "Applying migration ..." para cada gaveta nova e, no fim, "All migrations have been
  successfully applied". Se não há nada novo: "No pending migrations to apply".
- Sem as migrations de criativos e de `EmailDispatchLog` (o caderno de e-mails enviados), `/criativos` e os e-mails de
  cobrança dão erro de "tabela inexistente". Sem a `20261014120000_account_deletion_request`, a exclusão de conta (2.6) não
  funciona. Sem a `20261015120000_email_verification`, o cadastro e a confirmação de e-mail (2.7) dão erro. Sem a
  `20261016120000_search_run_cursor_060`, a busca de clientes (Fase 8) dá erro.
- As migrations novas só **acrescentam** gavetas (não jogam nada fora), então `migrate deploy` é seguro.
- ⚠️ **Depois de aplicar, pare o `npm run dev` e ligue de novo.** O app antigo guarda uma cópia velha do mapa das gavetas
  (o Prisma Client) e falha em silêncio.
- Como conferir: `npx prisma migrate status` não lista nenhuma migration pendente.

🚫 **NÃO use `prisma migrate dev` neste banco.** O aviso continua valendo (reconferido em 2026-10-11). O banco de dev tem
gavetas que o projeto atual não conhece, e o `npx prisma migrate status` também avisa, listando 5 migrations "não encontradas
localmente":
- `User.document` e `User.documentType`
- `Organization.document`, `documentType`, `documentBlocked` e `trialBlocked`
- `Plan.abacatepayProductId`
- os índices `User_document_*`

Elas vieram de migrations `20260928*` de outro computador, que **não existem neste projeto**. O `migrate dev` ia
propor **jogar fora essas gavetas e tudo que está dentro**. Um banco novo (clone limpo) não tem esse problema. Isso não atrapalha o
app nem o `migrate deploy`. A limpeza é uma decisão sua (veja `docs/RETOMAR.md`, seção 3b).

### 1.4 Colocar brinquedos de exemplo (seed)

```bash
npm run db:seed
```

- **O que você deve ver na tela:** mensagens de que criou o admin, os planos e os dados de exemplo. Sem erro vermelho.
- Os leads do seed têm `source="seed"` e **nunca recebem mensagem de verdade** (só receberiam se `ALLOW_SEED_SENDS`
  estivesse ligada; não ligue).
- Ele cria ou atualiza o admin usando `ADMIN_EMAIL` e `ADMIN_PASSWORD`. A senha precisa ter 12+ caracteres. Sem essas
  duas, o admin com senha não é criado e você não consegue entrar.
- Pode rodar de novo sem medo (idempotente: repetir não bagunça).

### 1.5 Ligar o app

```bash
npm run dev
```

- **O que você deve ver na tela:** "Ready" e o endereço http://localhost:3000.
- Como conferir, em outro terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000
```

Deve aparecer `200`. Isso quer dizer "tudo certo".

### 1.6 Entrar

Abra http://localhost:3000/login e use `ADMIN_EMAIL` e `ADMIN_PASSWORD` do seu `.env`.

- **O que você deve ver na tela:** o painel (`/dashboard`).

---

## Fase 2: cadastro, planos e cobrança sem gastar nada

### 2.1 Cobrança de mentirinha (mock): não precisa configurar nada

- Sem `PAYMENT_PROVIDER`, o padrão é `mock`. Checkout e trial funcionam do começo ao fim, sem conta e sem chaves.
- A Stripe é só um "esqueleto" (stub). O adaptador da AbacatePay (SPEC-047) existe, mas pede conta e chaves
  `ABACATEPAY_*`. Ele **não foi testado com conta de verdade**.
- `MOCK_WEBHOOK_SECRET` só serve para chamar a rota do carteiro `POST /api/billing/webhook` na mão. Sem ele, a rota
  responde 503. O checkout interno não precisa dele.
- **O que você deve ver na tela:** o cadastro de uma conta nova chega num checkout de faz de conta, **sem pedir cartão**.

### 2.2 Criar uma conta nova

Vá em `/signup` e crie uma conta.

- **O que você deve ver na tela:** você cai numa organização nova (outra sala).
- Com o Mailpit aberto (Fase 3), chega o e-mail **"início do trial"** para o dono da conta (SPEC-052a; só um por
  organização).
- No checkout de mentirinha, o e-mail "Assinatura confirmada" é esperado.
- O **recibo** só sai em renovação ou PIX pago, não no checkout de mentirinha.
- Isso foi esperado pela leitura do código e **não foi verificado em navegador**.

### 2.3 Várias pessoas na mesma empresa (multi-tenant, SPEC-049, já entregue)

Multi-tenant quer dizer: um prédio com vários apartamentos. Cada organização é um apartamento e ninguém vê o que
é do vizinho.

1. Crie uma 2ª organização em `/organizacoes`.
2. Convide um e-mail em `/configuracoes/equipe`.
3. Aceite o convite em `/convite/[token]` (o e-mail chega no Mailpit).
4. Troque de organização no seletor.

- **O que você deve ver na tela:** o convite chega no Mailpit com o e-mail mascarado; ao aceitar, a pessoa entra na
  organização; o seletor muda de "apartamento".
- Roteiro completo: bloco C de `docs/ROTEIRO_DE_TESTES.md`. O texto dele ainda diz que a 049b não existe: está
  desatualizado.
- Em bancos antigos, rode `npm run org:backfill-last`. Ele preenche `User.lastOrgId` (a última organização usada) e só
  imprime contagens. Pode repetir sem medo.
- Validação em navegador: **não foi feita**.

### 2.4 Menu lateral (SPEC-057)

O menu é dividido em quatro seções: **Captação de leads, Criativos, Automação e Conta**.

- Está marcada como IMPLEMENTED no `specs/README.md`, mas o código da sidebar ainda estava sendo ajustado nesta branch.
  Está **em andamento**: confira com os olhos depois que parar de mudar.
- O `platform_admin` (o "chefe do prédio") vê só o item "Administração" (`/admin/organizacoes`).

---

### 2.5 Cancelar a assinatura e voltar atrás (SPEC-053)

Agora dá para cancelar o plano sozinho, sem falar com ninguém. É como cancelar a revistinha: você continua recebendo até o
último dia que já pagou.

1. Entre em **Configurações > Assinatura**. Só o **dono** da organização vê o botão **Cancelar assinatura**.
2. Clique nele. Abre uma janelinha que diz até quando você ainda pode usar, que os seus dados ficam guardados por 90 dias
   e que não há devolução de dinheiro. Marque a caixinha "Entendi" e confirme.
3. Você continua usando tudo até o último dia pago. Chega um e-mail com o pedido e a data final.
   (Só vale "até o último dia" quando há plano pago ativo com período ainda em dia. Em trial, sem período, período já vencido
   ou pagamento incompleto, o cancelamento vale **na hora**, e o aviso da janelinha diz isso.)
4. Mudou de ideia antes do fim? Clique em **Manter assinatura**. Chega um e-mail confirmando. Só esse botão desfaz o
   cancelamento: um aviso vindo de fora (do provedor de pagamento) não desfaz sozinho um cancelamento já agendado.
5. Passado o último dia, a conta fica pausada e chega um e-mail dizendo que o cancelamento valeu. Para voltar, clique em
   **Reassinar**. Os dados ficam guardados por 90 dias; depois disso são apagados.
6. Se você ainda está no teste grátis (trial), cancelar vale **na hora**.
7. A janelinha de cancelar não fecha enquanto o pedido está sendo enviado (Esc, clique fora e "Voltar" ficam travados).

✅ O que você deve ver: um e-mail por ação (mesmo clicando duas vezes) no Mailpit, http://localhost:8025. Quem não é dono não
vê os botões. Para ver o "último dia" chegar, deixe `npm run dev:tick` aberto em outro terminal. A lista completa de testes
está no bloco H do `docs/ROTEIRO_DE_TESTES.md`.

⚠️ Se o pagamento é por cartão do AbacatePay, o cancelamento vale só dentro do LeadForge; o cartão pode continuar sendo
cobrado até alguém cancelar no painel do AbacatePay.

### 2.6 Apagar a minha conta (SPEC-054)

Imagine que a sua conta é uma casinha de brinquedos. Se você não quer mais brincar, pode pedir para "desmontar a casinha".
A gente é cuidadoso: pergunta duas vezes e espera 30 dias, caso você se arrependa.

1. Entre no LeadForge, clique em **Configurações** e depois na aba **Conta**.
2. Leia a caixa "Excluir minha conta". Ela mostra 3 listas:
   - o que é **apagado** (brinquedos jogados no lixo);
   - o que é **anonimizado** (um desenho em que o seu nome é apagado e vira "Usuário removido");
   - o que **fica guardado depois da exclusão** (o caderninho de pagamentos e outros registros). Além dos pagamentos e
     dos registros de acesso, a lista agora mostra também: a sua linha de usuário (já anonimizada), o registro do pedido de
     exclusão (só um código e um "carimbo" do e-mail, nunca apagado), e as reuniões e os criativos que você criou (eles
     continuam, mas apontam só para o "Usuário removido").
3. Se aparecer "Ainda não é possível excluir sua conta", ainda tem gente dentro da casinha ou conta pendente:
   - você é o único dono de uma organização com outras pessoas: passe a chave de dono para outra pessoa antes;
   - a sua organização ainda paga assinatura: cancele a assinatura antes (veja 2.5);
   - você é o único membro de uma organização que **não tem assinatura nenhuma**: a tela pede para falar com o suporte (senão a
     organização ficaria ativa sem dono). Isso vale no pedido, na confirmação e no dia da desmontagem (que fica adiada).
4. Sem aviso? Digite a **senha** (para provar que é você) e clique em **Excluir minha conta**.
5. Aparece "Confira seu e-mail". Abra o e-mail e clique no link.
6. A página pergunta "Confirmar a exclusão da conta?". Só abrir o link ainda não apaga nada. Clique em **Confirmar exclusão da conta**.
7. Aparece "Exclusão agendada" para daqui a **30 dias**, e chega outro e-mail com um link para cancelar. Nesses 30 dias a conta
   fica "dormindo": você não consegue entrar.
8. **Mudou de ideia?** Clique no link "cancelar" do e-mail e depois em **Cancelar a exclusão**. Ou, na tela de login, digite
   e-mail e senha e clique em **Cancelar exclusão e entrar**.
9. Se você não fizer nada, no dia marcado a conta é desmontada de verdade e chega um último e-mail dizendo o que foi apagado,
   o que foi anonimizado e o que ficou guardado.

✅ O que você deve ver: senha errada mostra "Senha incorreta"; link velho ou já usado mostra "Link inválido ou expirado";
depois de cancelar aparece "Exclusão cancelada" e você entra sem perder nada.

⚠️ Para testar de verdade você precisa do banco arrumado (`npx prisma migrate deploy`, veja 1.3) e do `npm run dev`
reiniciado. O despertador (`npm run dev:tick`) é quem faz a "desmontagem" no dia marcado. Os prazos de guarda (5 anos para
pagamentos, 6 meses para registros de acesso) ainda precisam ser conferidos por um advogado antes de ir para o ar.

### 2.7 Confirmar o e-mail (SPEC-055)

Pense no e-mail como o endereço da sua casinha. Antes de deixar você mandar cartinhas para os outros, o LeadForge quer ter
certeza de que o endereço é seu: manda uma cartinha para lá e você diz "recebi".

⚠️ Antes de testar: aplique a migration nova (`npx prisma migrate deploy`, veja 1.3) e pare e ligue o `npm run dev` de novo.

1. Abra o Mailpit (http://localhost:8025) numa aba. É a caixa de correio de mentirinha.
2. Crie uma conta nova em `/signup` (veja 2.2) com um e-mail inventado, por exemplo `crianca1@teste.local`.
3. No Mailpit chegam **dois e-mails** para esse endereço:
   - **Boas-vindas** (só um oi);
   - **Confirme seu e-mail**, com um botão/link que vai para `/verificar-email`.
4. Antes de clicar, entre no app. Lá em cima aparece uma **faixa** (banner) dizendo para confirmar o e-mail. Ela não tem
   "X" para fechar: só some quando você confirma.
5. Na faixa, clique em **Reenviar e-mail**. Chega outro e-mail. Se clicar de novo logo em seguida, aparece uma contagem
   regressiva (espera de 60 segundos) e, se abusar (mais de 5 por hora), uma mensagem de limite.
6. Tente **enviar uma mensagem** (por exemplo, aprovar um rascunho na fila). Enquanto o e-mail não foi confirmado, o envio é
   recusado com um aviso dizendo que é preciso confirmar o e-mail. Você **entra e usa o app normalmente**; só não consegue
   mandar mensagens para os seus leads. As mensagens automáticas das sequências ficam esperando (nada se perde) e tentam de
   novo mais tarde.
7. Clique no link do e-mail "Confirme seu e-mail". A página mostra que deu certo e tem o botão **Ir para o app**. A faixa some e
   os envios voltam a funcionar.
8. Clique no mesmo link outra vez: aparece uma mensagem de erro ("link inválido ou expirado"), porque cada link vale uma vez só
   e dura 24 horas.
9. **Senha alterada:** em `/esqueci-senha` peça a troca da senha, use o link do e-mail e defina uma senha nova. Chega mais um
   e-mail avisando "sua senha foi alterada", com a orientação "não foi você? fale com a gente".

✅ O que você deve ver: 2 e-mails no cadastro (boas-vindas e confirmação), a faixa com **Reenviar e-mail**, o aviso ao tentar
enviar sem confirmar, **Ir para o app** depois de confirmar e o e-mail de senha alterada. Quem já existia antes desta
atualização foi marcado como confirmado (não vê faixa). Cadastro com e-mail que já existe responde igual ao de um e-mail novo e
não manda e-mail de boas-vindas (para ninguém descobrir quem tem conta). Quem entra por convite com o **mesmo** e-mail
convidado já nasce confirmado; quem entra por código de entrada, não. A lista de testes está no bloco J do
`docs/ROTEIRO_DE_TESTES.md`.

⚠️ Coisas para saber: a aprovação de vários rascunhos de uma vez só mostra "bloqueado" (não diz que o motivo é o e-mail não
confirmado). Os limites de reenvio ficam na memória do app e zeram quando ele reinicia. Ainda não existe tela para trocar a
senha ou o e-mail já logado (só o reset por e-mail).

### 2.8 Avisos para os donos da empresa (SPEC-056)

Imagine a sua empresa como um clubinho com um porteiro. Toda vez que alguém **entra**, **sai**, é **tirado** ou **troca de
cargo**, o porteiro avisa os donos (owners) por e-mail, para ninguém ser pego de surpresa. Esta parte não tem migration nova.

1. Tenha uma organização com pelo menos 2 donos (owners) e o Mailpit aberto (http://localhost:8025).
2. **Entrar:** com um convidado, aceite o convite (ou entre pelo código de entrada). Cada dono recebe 1 e-mail "alguém entrou".
3. **Sair:** como membro, saia da organização. Os donos recebem 1 e-mail "alguém saiu".
4. **Ser removido:** como dono, remova um membro em Configurações > Equipe. Os outros donos recebem 1 e-mail. O membro
   removido **não** recebe e-mail desta SPEC.
5. **Mudar de papel:** como dono, mude o papel de um membro (por exemplo, member para owner). Os donos recebem 1 e-mail. Se
   você "mudar" para o mesmo papel que ele já tem, não sai e-mail.
6. **Quem fez a ação não recebe:** se você, dono, removeu alguém, o aviso vai para os **outros** donos, não para você. Quem
   entrou ou saiu também não recebe o próprio aviso.
7. **Limite:** só as **entradas** têm teto: 10 e-mails por hora por organização (para o código de entrada não virar spam).
   Da 11ª entrada na mesma hora em diante, o e-mail não sai, mas a entrada continua registrada no histórico da organização.

✅ O que você deve ver: no Mailpit, 1 e-mail por evento e por dono (sem duplicar se você clicar duas vezes), nenhum para quem
fez a ação, nenhum quando a ação é recusada ou não muda nada. Se o envio falhar, a ação em si (entrar, sair, remover) continua
valendo: o e-mail sai só depois que a mudança foi gravada. A lista de testes está no bloco K do `docs/ROTEIRO_DE_TESTES.md`.

⚠️ Se o provedor de e-mail falhar na hora do envio, aquele aviso se perde (não há nova tentativa).

### 2.9 Limite de tentativas que não esquece (Redis, SPEC-059)

Pense num porteiro que só deixa você tentar a senha algumas vezes. Antes, ele anotava no ar: se o app reiniciava, esquecia tudo.
Agora ele pode anotar no **Redis** (o bloquinho de recados da caixinha `leadforge-redis-1`), e aí lembra mesmo depois de reiniciar.
**É opcional.** Sem fazer nada, tudo funciona como antes.

1. Confira que a caixinha está ligada: `docker ps` mostra `leadforge-redis-1` (passo 1.2).
2. No `.env`, acrescente a linha `REDIS_URL=redis://localhost:6379`.
3. Pare e ligue o `npm run dev` de novo.
4. Para testar: erre a senha do login algumas vezes. Reinicie o `npm run dev` e tente de novo: o bloqueio continua.

✅ O que você deve ver: o mesmo bloqueio de antes, só que ele **sobrevive ao reinício**. Se você desligar o Redis
(`docker stop leadforge-redis-1`), o app não quebra: no terminal do `npm run dev` aparece um aviso `[rate-limit]` e o porteiro
volta a anotar no ar. Sem `REDIS_URL` nenhum aviso aparece (é o jeito antigo). Nas chaves guardadas no Redis, e-mails e IPs
ficam embaralhados (hash), nunca em texto claro. Em produção com mais de uma cópia do app, defina `REDIS_URL`, senão cada cópia
conta separado. A lista de testes está no bloco M do `docs/ROTEIRO_DE_TESTES.md`.

⚠️ Se você instalou um Redis no seu Mac (Homebrew), ele pode ficar com a porta 6379 no lugar da caixinha do Docker. Tudo
continua funcionando (o porteiro anota nesse Redis), só não vai aparecer em `docker exec leadforge-redis-1 redis-cli`. Para ver
quem está na porta: `lsof -nP -iTCP:6379 -sTCP:LISTEN`.

### 2.10 Formulários que avisam erro na hora (SPEC-045)

Pense numa professora que confere o seu caderno **enquanto você escreve**, e não só quando você entrega. Os formulários de
**e-mail, integrações, lista de bloqueio, WhatsApp e suspender empresa** (admin) agora avisam o erro no próprio campo e levam o
cursor até ele. **Nada para configurar.** As regras são as mesmas de antes.

1. Entre em **Configurações > E-mail** e clique para adicionar uma conta. Deixe um campo obrigatório vazio e salve.
2. ✅ O que você deve ver: uma mensagem vermelha junto do campo, e o cursor pulando para ele.

A lista de testes está no bloco O do `docs/ROTEIRO_DE_TESTES.md`.

## Fase 3: e-mail (escolha UMA opção)

### 3.A Sem enviar nada de verdade (✅ JÁ CONFIGURADO neste ambiente)

É o Mailpit, a caixa de correio de brinquedo. Já aceita qualquer login. Para criar do zero:

```bash
docker run -d --name mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit
```

- No `.env`: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true`. Reinicie o app ao mudar.
- **O que você deve ver na tela:** em http://localhost:8025, uma caixa de entrada. As mensagens somem se a caixinha for
  recriada.
- Quem manda o e-mail de sistema (reset de senha, convite, trial, cobrança)? O sistema tenta nesta ordem:
  1. ACS (`EMAIL_PROVIDER=acs`)
  2. Resend (se houver `RESEND_API_KEY`)
  3. o SMTP do `.env`

  Sem os dois primeiros, cai no Mailpit.

**E-mails automáticos das SPECs 052a/052b que você vê aqui:**
- início do trial (no cadastro ou numa organização nova)
- "Assinatura confirmada"
- recibo (renovação ou PIX)
- **falha de pagamento imediata**
- **régua de cobrança D+3, D+5 e D+6:** é uma escadinha de lembretes. **D+6 é o último aviso**, 24 horas antes de
  suspender. Vale igual para cartão e PIX. O prazo de tolerância (grace) de 7 dias não mudou.
- **pagamento regularizado**
- **próxima cobrança** (7 dias antes; só plano anual e PIX)
- **troca de plano**

Como disparar na sua máquina: o carteiro (webhook) do provedor mock avisa e o despertador (`npm run dev:tick`) acorda
o sistema. Passos E6 a E10 do `docs/ROTEIRO_DE_TESTES.md`.

**O que NÃO existe:**
- e-mail de falha ou recuperação de **cartão** da AbacatePay (pergunta Q-052-5 ainda aberta; não se sabe o nome dos
  eventos)
- PDF ou nota fiscal (o recibo é só informativo)
- As SPECs 053 a 056 (cancelamento, exclusão LGPD, boas-vindas/verificação, e-mails de organização) **já existem no app**
  (veja 2.5 a 2.8).

**Para voltar a mandar pelo Gmail de verdade:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, apague
`ALLOW_PRIVATE_SMTP_HOSTS` e reinicie. Sem isso, nenhum e-mail sai da sua máquina.

### 3.B Resend (grátis, 100 por dia)

No `.env`: `RESEND_API_KEY=` e `RESEND_FROM_NOREPLY=` (um domínio verificado, ou seja, confirmado como seu).

### 3.C Azure Communication Services (SPEC-048)

No `.env`: `EMAIL_PROVIDER=acs`, `AZURE_COMMUNICATION_CONNECTION_STRING=` e `ACS_FROM_NOREPLY=` (o MailFrom do domínio
verificado no ACS). Passo a passo na seção 2b de `docs/CONFIGURACAO_POS_PROJETO.md`.

### Como conferir (qualquer opção)

Abra `/esqueci-senha`, digite o e-mail do admin e envie.

- **O que você deve ver na tela:** uma mensagem de "e-mail enviado" e, na sua caixa (Mailpit ou real), a mensagem
  chegando.

Custo: Mailpit é grátis. Resend tem 100 por dia grátis (confirme no site). ACS cobra por e-mail (confirme no portal
Azure). Nunca foi testado contra Resend nem ACS de verdade: só testes com provedor de mentirinha.

---

## Fase 4: arquivos (SPEC-050), funciona sem Azure

### 4.1 Para testar, não precisa fazer nada

- Sem `AZURE_STORAGE_CONNECTION_STRING`, o provider **`local`** guarda os arquivos na pasta `.storage/` do projeto.
  O git ignora essa pasta.
- `STORAGE_LOCAL_DIR` muda a pasta.
- Em produção, sem Azure e sem `STORAGE_PROVIDER=local`, a função responde 503.
- Limites opcionais: `STORAGE_MAX_FILE_BYTES` e `STORAGE_ALLOWED_MIME` (os tipos de arquivo aceitos).
- Rotas: `/api/storage/files`.
- Custo local: zero.
- ⚠️ Limitação: disco local não serve para produção na Vercel (lá o disco some a cada vez, é efêmero).

### 4.2 Azure Blob de verdade (depois)

No `.env`: `AZURE_STORAGE_CONNECTION_STRING=` e `AZURE_STORAGE_CONTAINER=` (o container tem que ser **privado**).
Seção 2c de `docs/CONFIGURACAO_POS_PROJETO.md`.

- Nunca foi testado contra Azure de verdade: só com mock e links SAS (de acesso temporário) sem internet.

---

## Fase 5: WhatsApp (opcional)

### 5.1 Ligar a Evolution

A Evolution é a ponte entre o LeadForge e o WhatsApp.

```bash
docker compose up -d evolution
```

- Ela não sobe junto com o passo 1.2. Usa a porta 8080 e precisa de `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` no
  `.env` (já estão lá).
- **O que você deve ver na tela:** `docker ps` mostra a Evolution, e a tela de WhatsApp lista a instância.
- O `n8n` (SPEC-014) é opcional: `docker compose up -d n8n`, porta 5678. Ele é um robô que liga um app a outro.
  A entrada de leads por `POST /api/integrations/leads` só liga com `INTEGRATION_LEADS_ENABLED=true` e um
  `INGEST_SECRET` de 32+ caracteres. Veja `docs/N8N.md`.

### 5.2 Conectar um número

Em Configurações > WhatsApp, crie a instância e leia o QR code com o celular.

- **O que você deve ver na tela:** um quadradinho de QR code; depois de ler, o status fica "conectado".
- ⚠️ Use um **chip descartável**. A Evolution não é oficial e o número pode ser banido. Custo: o chip. Não foi
  verificado do começo ao fim nesta revisão.

---

## Fase 6: o cérebro dos agentes (LLM, SPEC-018/019)

LLM é um "cérebro de computador" que sabe escrever textos. Os agentes do LeadForge usam um para escrever mensagens.

**Como está hoje:** o cérebro pode ser o **Claude** (pago, o padrão) ou qualquer cérebro "no formato OpenAI" que você escolher por
organização (SPEC-036): Groq, OpenRouter, Ollama (no seu computador) ou Gemini. Isso é o que dá para usar **de graça**. Existe
também um `FakeLlmProvider` (de mentirinha, só para testes).

### 6.1 Testar sem cérebro (grátis)

Deixe os agentes desligados (o interruptor geral, kill switch, já vem desligado) e use textos fixos (templates) nos
passos da sequência.

- **O que você deve ver na tela:** as sequências andam com textos prontos, sem agente escrevendo.

### 6.2 Testar com Claude (pago)

Em Configurações > Integrações > **Provedor de LLM**, deixe a **URL base vazia** e cole a chave da Anthropic. Ela fica trancada
(cifrada) com a `ENCRYPTION_KEY`. Sem URL, o LeadForge usa o Claude como sempre.

### 6.3 Usar um cérebro grátis (SPEC-036)

É como escolher quem escreve as cartinhas: você só troca o endereço do escritor. Passo a passo:

1. Entre em `/configuracoes/integracoes` e ache o card **Provedor de LLM**.
2. No campo **URL base**, cole o endereço do escritor (os exemplos aparecem no próprio card):
   - **Ollama (no seu computador):** `http://localhost:11434/v1`. Grátis, nada sai do seu computador. Instale o Ollama e deixe
     rodando. A chave pode ficar vazia.
   - **Gemini:** `https://generativelanguage.googleapis.com/v1beta/openai`. Pegue a chave grátis no Google AI Studio.
   - **Groq** ou **OpenRouter:** use o endereço que o site deles mostra, e a chave deles.
3. No campo **chave**, cole a chave do provedor (o card tem um link para a página onde ela é gerada). No Ollama pode ficar vazio.
4. **Só no Ollama ou em outro servidor seu, em rede privada:** marque **"instância própria"**. Sem essa caixinha, o LeadForge
   recusa endereços de dentro do seu computador (proteção). Marque só se o endereço for realmente seu: é isso que faz o custo
   contar como zero.
5. Clique em **Testar conexão**.
6. Salve. Depois, nos agentes, o botão **Simular** mostra qual provedor e qual modelo foram usados.

- **O que você deve ver na tela:** "conexão ok" no teste, e no Simular o nome do provedor e do modelo.
- ⚠️ **Voltar do grátis para o Claude:** apague a integração e crie de novo (só limpar o campo da URL não basta).
- ⚠️ Na Gemini grátis, o conteúdo pode ser usado para melhorar produtos do Google (cuidado com LGPD e dados de leads). Confirme
  limites e termos na página oficial de cada um: mudam sempre. Se der erro 429, você bateu no limite do plano grátis: espere
  um pouco ou troque para o Ollama.
- ⚠️ **Ainda não foi validado com Ollama nem Gemini de verdade**: só testes automáticos. Teste você e conte o que viu. Lista de
  testes: bloco L do `docs/ROTEIRO_DE_TESTES.md`. Não precisa de migration nem de variável nova no `.env`.

---

## Fase 7: criativos com avatar (SPEC-051, provedor de demonstração; avatar de mentirinha)

### 7.1 Aplicar as gavetas e reiniciar

Faça o passo 1.3 e reinicie o `npm run dev`. Entre em **`/criativos`** (item "Criativos" no menu).

- **O que você deve ver na tela:** a página de criativos com o aviso "Provedor de demonstração (mock)".

### 7.2 Não precisa configurar nada

O provider padrão é **`mock`**: faz um vídeo placeholder (de enfeite), custo zero, e nunca usa a internet. Em
produção, só liga com `CREATIVE_PROVIDER=mock` escrito de propósito.

### 7.3 Os criativos só andam quando o despertador (tick) toca

Em casa, ninguém toca o despertador sozinho. Num **segundo terminal**, deixe rodando:

```bash
npm run dev:tick
```

- Ele chama `POST /api/cron/tick` a cada 15 segundos. `DEV_TICK_INTERVAL_MS` ajusta (mínimo 2000).
- **O que você deve ver na tela:** o criativo sai de "Na fila" e termina em uns 15 a 30 segundos (o mock leva uns
  3 s; `CREATIVE_MOCK_DELAY_MS` muda isso).
- Sem o tick, o criativo fica parado em "Na fila".

Modo manual, sem ficar em loop:

```bash
npm run tick
```

Ele também cuida dos criativos. Na 1ª rodada envia ao mock e na 2ª termina. Ou, com `curl`:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

### 7.4 Limites por organização

As envs `CREATIVE_*` (veja `.env.example`) limitam: 2 gerações ao mesmo tempo e 20 criativos por mês.

### Coisas para saber

- Provedor de verdade (HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar): decisão em aberto (Q-051-1). Antes de
  ligar um, cumpra o D-051-15 da SPEC-051 (proteção SSRF, que impede o servidor de ser enganado a visitar endereços
  perigosos, e limites de tempo no download do vídeo).
- Limitação: o vídeo é um placeholder. Nenhum avatar de verdade é gerado. Custo: zero. O único provider aceito em
  `CREATIVE_PROVIDERS` é `mock`.
- Status: 051a (backend) e 051b (frontend) constam como IMPLEMENTED no `specs/README.md`. **Não validado em navegador
  logado.**

---

## Fase 8: achar clientes no Google Maps (Places, SPEC-015; botão "Buscar leads" na campanha)

**Vem desligada** (`LEAD_SEARCH_ENABLED` não está no seu `.env`). O app usa só a **Places API (New)**
(`POST places.googleapis.com/v1/places:searchText`) com uma chave de API (uma "senha" para falar com o Google).
Não usa Maps JavaScript, mapa nem geocoding. A chave fica só no servidor (cabeçalho `X-Goog-Api-Key`) e trancada
(cifrada) no banco.

Ele traz nome, telefone, site, endereço e nota. **Não traz e-mail de decisor.**

### 8.1 a 8.6: preparar o Google

- [ ] **8.1 Projeto no Google Cloud.** console.cloud.google.com e crie um projeto.
- [ ] **8.2 Faturamento.** O Google pede cartão para liberar a chave, mesmo dentro da cota grátis.
- [ ] **8.3 Ativar a "Places API (New)".** Não confunda com a "Places API" antiga: o código usa a nova.
- [ ] **8.4 Criar a chave** em APIs e serviços > Credenciais > chave de API.
- [ ] **8.5 Restringir a chave** só à "Places API (New)". **Não** restrinja por site (a chamada sai do servidor). Por IP,
  só se o servidor tiver IP fixo.
- [ ] **8.6 Teto e alerta de orçamento** em Faturamento. É a sua proteção de verdade contra gastar demais.

### 8.7 Guardar a chave no app

Logado como **admin**: `/configuracoes/integracoes` > Places > cole a chave.

### 8.8 Ligar

No `.env`: `LEAD_SEARCH_ENABLED=true`. Depois **reinicie o `npm run dev`**.

Tetos opcionais (limites de segurança):
- `LEAD_SEARCH_MAX_RESULTS`: padrão 20, máximo 60
- `LEAD_SEARCH_DAILY_MAX_REQUESTS`: padrão 3 por dia por campanha (busca diária feita pelo tick)
- `LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK`: padrão 3
- `LEAD_SEARCH_TICK_DEADLINE_MS`: padrão 30000
- da SPEC-058: `LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS` (padrão 2 por dia por campanha) e
  `LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS` (padrão 10 por dia por organização)

### 8.9 Testar

1. Crie uma campanha **ativa** com ICP (o "cliente ideal"; exemplo: nicho "dentistas", local "Curitiba").
2. Abra `/campanhas/[id]` e clique em **Buscar leads**. Ou deixe o `npm run dev:tick` rodando para a busca diária.

- **O que você deve ver na tela:** o resultado mostra quantos são novos e quantos já existiam (duplicados). Os leads
  entram em `/leads` e no Pipeline como `novo_lead`, sem repetidos e sem quem pediu para não ser contatado (opt-out).
- Depois da primeira busca, o botão passa a dizer **Buscar mais resultados** (SPEC-060). É como virar a página do catálogo: cada
  clique continua de onde parou e traz clientes **novos**. Quando as páginas acabam, ele passa para outras "variações" da
  busca. Cada clique faz **1 a 2 chamadas pagas** ao Google e nunca passa do teto do dia (SPEC-058).
- ⚠️ Antes de usar, aplique a migration nova (`npx prisma migrate deploy`, veja 1.3) e reinicie o `npm run dev`; sem ela a busca
  dá erro. Se mudar o nicho ou o local da campanha, a busca recomeça do início.

### Quanto custa

Consultado em 2026-09-19 no `docs/GUIA.md` 4.6 (confirme na página oficial, muda):
- Text Search Pro: 5.000 grátis por mês; depois US$ 32 por 1.000.
- Enterprise: 1.000 grátis por mês; depois US$ 35 por 1.000.
- Telefone e site tendem a cair na Enterprise, mas **o SKU realmente cobrado não foi confirmado**.

### Cuidados

Os termos da Places API limitam guardar dados (cache). Confirme os termos atuais antes de usar em grande escala. Base
legal registrada: interesse legítimo B2B, com o opt-out aplicado antes de criar o lead.

### Como está

SPEC-058 IMPLEMENTADA (058a backend e 058b frontend, QA aprovado em 2026-10-10):
- só o **owner** (dono) dispara "Buscar agora"
- tetos manuais de 2 por dia por campanha e 10 por dia por organização, separados do teto da busca diária
- o estado "rodando" sobrevive a recarregar a página
- o resultado mostra novos, duplicados e suprimidos

SPEC-060 IMPLEMENTADA: paginação com "Buscar mais resultados" (ver 8.9). Também **sem chave real do Google**: validação pendente.

⚠️ **Nunca rodou com a API de verdade do Google** (só testes com resposta de mentirinha) e a tela nunca foi vista em
navegador. Use os blocos G e N de `docs/ROTEIRO_DE_TESTES.md`.

---

## Fase 9: colocar no ar (produção, Vercel)

Até aqui o LeadForge morou na **sua casa** (o seu computador). Agora vamos mudá-lo para um **prédio público** na internet, onde
qualquer pessoa chega pelo endereço. Mudança de casa tem lista: se faltar uma caixa, falta o prato. Siga na ordem e marque ✅.

⚠️ **Regra de ouro:** em produção **nada de brinquedo**. Sem `mock` de cobrança, sem `ALLOW_SEED_SENDS`, sem Mailpit.
Nunca coloque segredos no GitHub: eles vão só no painel da Vercel (Settings > Environment Variables).

### 9.1 O armário de produção (Postgres gerenciado)

O Postgres do Docker é só da sua casa. Em produção você precisa de um armário na nuvem (Neon, Supabase, Vercel Marketplace
ou outro Postgres).

1. Crie um banco Postgres na nuvem e copie **dois** endereços: o **normal com pool** e o **direto sem pool** (unpooled).
2. Na Vercel, crie `DATABASE_URL` (com pool) e `DATABASE_URL_UNPOOLED` (direto).

✅ O que você deve ver: no build da Vercel, o `vercel.json` roda sozinho `prisma migrate deploy` (arruma as gavetas) usando o
endereço direto. Se o build falhar aqui, o endereço direto está errado.

### 9.2 O bloquinho de recados (Redis)

1. Crie um Redis na nuvem (Upstash ou Vercel Marketplace) e copie a URL (`rediss://...`).
2. Na Vercel, crie `REDIS_URL`. Sem ele o app funciona, mas o limite de tentativas vale só por cópia do app (veja 2.9).

### 9.3 Os segredos (gere cada um com seu próprio comando)

Cada um é uma senha longa e **diferente**. No terminal:

```bash
openssl rand -base64 48     # AUTH_SECRET
openssl rand -base64 32     # ENCRYPTION_KEY (guarde cópia: se perder, senhas SMTP e links de descadastro quebram)
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'   # CRON_SECRET (rode de novo para INGEST_SECRET, se usar)
```

Crie na Vercel: `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`.

### 9.4 O endereço e quem é o chefe

1. Compre/aponte o domínio na Vercel (Settings > Domains). Use `https`.
2. Crie `AUTH_URL` e `APP_BASE_URL` com o endereço final (ex.: `https://app.seudominio.com`, **sem** barra no fim). Os links
   dos e-mails (convite, confirmar e-mail, excluir conta) usam esse endereço.
3. Crie `TRUSTED_PROXY_IP_HEADER=x-real-ip`. **É obrigatória em produção**: sem ela o limite por IP fica desligado.
4. Crie `ADMIN_EMAIL` e `ADMIN_PASSWORD` (12+ caracteres, forte). O seed cria esse usuário. ⚠️ A cada deploy a senha dele é
   **reposta** para o valor de `ADMIN_PASSWORD`. Mudou a senha pelo app? Mude também aqui.

✅ O que você deve ver: no log do build, `[seed] producao: dados de demonstração ignorados (só planos e admin).`.
Em produção o seed **não** cria organização nem leads de brinquedo (a Vercel define `VERCEL_ENV=production` sozinha).

⚠️ Os preços dos planos vêm marcados como **PLACEHOLDER** (D-33-2). O seed só cria o plano se ele não existir; para mudar o
preço depois, edite a tabela `Plan` ou peça uma SPEC. Confira antes de abrir para o público.

### 9.5 E-mail de verdade (escolha UMA opção, veja a Fase 3)

Sem e-mail real ninguém recebe convite, confirmação, recibo nem aviso de cobrança.

- **Resend:** `RESEND_API_KEY` + `RESEND_FROM_NOREPLY`, `RESEND_FROM_SUPPORT`, `RESEND_FROM_BILLING` (domínio verificado no Resend).
- **Azure (ACS):** `EMAIL_PROVIDER=acs`, `AZURE_COMMUNICATION_CONNECTION_STRING`, `ACS_FROM_NOREPLY`, `ACS_FROM_SUPPORT`, `ACS_FROM_BILLING`.
- **Só SMTP:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

⚠️ O remetente do `.env` de dev (`seu-email@gmail.com`) é de mentirinha. Use um endereço do **seu domínio**, verificado
(SPF/DKIM) no provedor, senão cai no spam.

### 9.6 Arquivos (vídeos e imagens)

Sem Azure Blob, `/criativos` e downloads respondem 503 em produção.

1. Crie uma conta de armazenamento no Azure e um container **privado**.
2. Na Vercel: `STORAGE_PROVIDER=azure`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`.
3. Criativos: `CREATIVE_PROVIDER=mock` (o avatar real ainda não existe; os vídeos continuam de mentirinha).

### 9.7 Cobrança de verdade (AbacatePay)

1. Crie a conta e pegue `ABACATEPAY_API_KEY` e invente um `ABACATEPAY_WEBHOOK_SECRET` (32+ caracteres).
2. Na Vercel: `PAYMENT_PROVIDER=abacatepay`, e as duas chaves.
3. No painel do AbacatePay, cadastre o webhook (o carteiro) apontando para `https://SEU-ENDERECO/api/billing/webhook`
   com o segredo, como o provedor pedir.
4. Faça **um pagamento de teste** (PIX de valor baixo ou o modo de teste do provedor) antes de abrir ao público.

⚠️ Ainda **não validado** com o AbacatePay real: o formato do recibo e o aviso de **falha de cartão** (a documentação não tem
esse evento, Q-052-5). O cancelamento de cartão vale só dentro do LeadForge; cancele também no painel do AbacatePay. **Não** use
`PAYMENT_PROVIDER=stripe` (é só um esqueleto).

### 9.8 O despertador (tick) e o plano da Vercel

1. Crie `CRON_SECRET` (9.3). O `vercel.json` agenda `/api/cron/tick` **1 vez por dia** (o plano grátis, Hobby, só aceita isso; um
   horário "a cada minuto" faz o **deploy falhar** com "Hobby accounts are limited to daily cron jobs") e a Vercel manda o segredo sozinha.
2. **O despertador de verdade (grátis): o GitHub.** O arquivo `.github/workflows/tick.yml` chama o tick **a cada 5 minutos**.
   No GitHub: Settings > Secrets and variables > Actions > New repository secret. Crie dois: `CRON_SECRET` (o **mesmo** valor da
   Vercel) e `APP_URL` (o endereço do app, ex.: `https://app.seudominio.com`, sem barra no fim). Teste em Actions > "Tick
   (agendador)" > Run workflow. ✅ Deve ver: o job verde e `HTTP 200`. (`HTTP 503` = falta `CRON_SECRET` na Vercel; `401` = valores diferentes.)
   Com plano Pro da Vercel você pode trocar para `* * * * *` no `vercel.json` e desligar o workflow.
3. Sem o workflow, mensagens, criativos, cancelamentos e busca só andam 1 vez por dia. Alternativa ao GitHub: qualquer agendador
   externo (ex.: cron-job.org) chamando `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://SEU-ENDERECO/api/cron/tick`.

### 9.9 Opcionais (deixe desligado no começo)

- **WhatsApp (Evolution):** precisa de um servidor próprio (Fase 5). Deixe para depois.
- **Busca de clientes (Google Places):** `LEAD_SEARCH_ENABLED=true` e a chave nas Integrações (Fase 8). Ponha teto de gasto no Google.
- **LLM dos agentes:** chave do Claude ou provedor grátis no painel (Fase 6).
- **Nunca em produção:** `ALLOW_SEED_SENDS`, `ALLOW_PRIVATE_SMTP_HOSTS`, `MOCK_WEBHOOK_SECRET`, `PAYMENT_PROVIDER=mock`.

### 9.10 Depois do deploy: o roteiro de conferência (15 minutos)

Faça com um e-mail seu de verdade. Marque ✅.

1. **A casa abriu?** Abra `https://SEU-ENDERECO/login`. ✅ Aparece a tela de login com cadeadinho (https).
2. **Entrar como admin** com `ADMIN_EMAIL`/`ADMIN_PASSWORD`. ✅ Entra sem erro.
3. **Cadastro novo:** crie uma conta com outro e-mail seu. ✅ Chegam os e-mails (boas-vindas, confirmar e-mail, início do teste).
   Os links começam com o endereço de produção, não com `localhost`.
4. **Confirmar o e-mail:** clique no link. ✅ A faixa "confirme seu e-mail" some.
5. **Esqueci a senha:** peça a redefinição. ✅ Chega o e-mail e o link funciona.
6. **Convite:** convide uma terceira pessoa para a organização. ✅ Chega o convite e ela entra.
7. **Isolamento:** entre com duas contas em organizações diferentes. ✅ Uma **não vê** os leads, campanhas e criativos da outra.
8. **Cobrança:** faça o pagamento de teste (9.7). ✅ Chega "Assinatura confirmada" e o recibo, **1 vez cada**.
9. **Cancelar:** Configurações > Assinatura > Cancelar. ✅ Chega o aviso e a data final (seção 2.5).
10. **O despertador toca?** Nos Logs da Vercel, filtre por `/api/cron/tick`. ✅ Aparece uma chamada por minuto, resposta 200. (503 =
    falta `CRON_SECRET`.)
11. **Limite de tentativas:** erre a senha várias vezes. ✅ O login bloqueia (com `REDIS_URL`, o bloqueio sobrevive a novo deploy).
12. **Sem brinquedo:** no painel do admin, a lista não tem "Organização de Seed" nem leads "Contato 1...20". ✅

Se algum item falhar, veja "Se deu ruim, olhe aqui" no fim deste guia. Antes de abrir ao público ainda faltam, por sua conta:
**parecer jurídico** dos prazos de guarda de dados (D-054-4), **termos de uso e política de privacidade**, e **teste à mão**
dos blocos H a N do `docs/ROTEIRO_DE_TESTES.md`.

## Testes (o professor corrigindo a prova)

### Conferir o código

```bash
npx tsc --noEmit
npm run lint
```

`npm run typecheck` faz o mesmo que o `tsc`.

- **O que você deve ver na tela:** o `tsc` sem nenhuma linha de erro; o `lint` com 0 erros.
- Estado em 2026-10-11 (depois da SPEC-060): `tsc` limpo; `lint` com 0 erros; vitest completo em banco novo: 163 arquivos,
  2053 testes passando.

### Rodar os testes (vitest)

⚠️ **Use um banco de teste limpo.** O `leadforge_test` acumula sujeira e dá falsas falhas (por exemplo
`Unique constraint failed on WhatsAppInstance_instanceName_key` e contagens 21 contra 20). Num banco novo:

```bash
TEST_DATABASE_URL=postgresql://leadforge:<senha>@localhost:5434/leadforge_clean_test npm test
```

- O setup cria, arruma e semeia o banco sozinho. O nome precisa terminar em `_test`.
- **O que você deve ver na tela:** a lista dos arquivos de teste passando e, no fim, "Tests ... passed".
- 🚫 **Nunca rode os testes sem `TEST_DATABASE_URL`**: eles cairiam no `leadforge_test` compartilhado e sujo.
- A última rodada completa registrada em banco limpo (SPEC-060) foi de 163 arquivos e 2053 testes passando.
- Para apagar e recriar o banco de teste: `npm run test:db:reset`.

---

## Se deu ruim, olhe aqui

- **A página `/` mostra erro 500.** O armário (Postgres) está desligado. Faça os passos 1.1 e 1.2.
- **`docker ps` falha falando de "colima.sock".** O Colima está parado. Rode `colima start`.
- **`prisma migrate dev` quer apagar colunas.** É o desencontro do banco de dev (drift). **Não confirme.** Use
  `migrate deploy`.
- **A busca de clientes dá erro depois de atualizar o código.** Falta a migration da 060 ou o `npm run dev` não foi
  reiniciado. Passo 1.3.
- **Aparece `[rate-limit]` no terminal.** O Redis não respondeu e o limite voltou a ser guardado na memória do app. Veja 2.9.
- **O deploy na Vercel falha com "Hobby accounts are limited to daily cron jobs".** O cron do `vercel.json` está mais frequente
  que 1 vez por dia. Use `0 6 * * *` (e o workflow do GitHub para o resto, 9.8) ou o plano Pro.
- **O app não liga em produção.** Falta `TRUSTED_PROXY_IP_HEADER`. Defina (exemplo: `x-real-ip`). É obrigatória em
  produção (SPEC-049; o `next build` não exige).
- **Nada roda sozinho em produção (mensagens, busca, criativos).** Falta agendar o despertador (tick) ou falta o
  `CRON_SECRET` (32+ caracteres; sem ele `/api/cron/tick` responde 503). O `vercel.json` só agenda o tick 1 vez
  por dia (plano Hobby); o despertador a cada 5 minutos é o workflow `.github/workflows/tick.yml` (precisa dos segredos `CRON_SECRET` e
  `APP_URL` no GitHub, veja 9.8). Defina o `CRON_SECRET`. Veja `docs/CONFIGURACAO_POS_PROJETO.md`.
- **`/criativos` ou `/api/storage/*` dão 503 em produção.** `CREATIVE_PROVIDER=mock` e/ou o storage não foram
  definidos. Veja as Fases 4 e 7.
- **O limite de pedidos por IP (rate limit) aparece "desligado" em produção.** Mesma causa de cima
  (`TRUSTED_PROXY_IP_HEADER`).
- **O e-mail não chega na caixa.** Talvez você esteja olhando o lugar errado. Com o Mailpit, abra
  http://localhost:8025 (não o Gmail).
- **O e-mail não chega nem no Mailpit.** A caixinha está parada ou o `.env` mudou sem reiniciar. `docker ps` mostra o
  `mailpit`? Reinicie o `npm run dev`.
- **A busca de leads diz "indisponível" ou não acha nada.** `LEAD_SEARCH_ENABLED` não está ligada, a chave `places`
  não foi cadastrada ou a campanha está inativa. Veja a Fase 8.
- **O e-mail de trial ou de recibo não chega depois de uma migration nova.** O `npm run dev` antigo ainda segura o
  Prisma Client velho e falha em silêncio. Pare e reinicie o `npm run dev`.
- **O criativo fica em "Na fila".** O despertador não tocou. Rode `npm run dev:tick` em outro terminal (passo 7.3).
- **`/criativos` dá erro de tabela.** A migration dos criativos não foi aplicada. Passo 1.3.
