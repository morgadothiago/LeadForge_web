# Os 10 testes de maior risco (faça estes primeiro)

Este guia é para **você** fazer depois, com calma. Cada teste diz o que fazer e o que você deve ver. Se bater com o "deve ver",
marque ✅ aqui e também `[x]` na linha indicada de `docs/ROTEIRO_DE_TESTES.md`. Se não bater, anote o que apareceu e me mande.

Ordem: do que **perde mais** se falhar (dinheiro, dados de outro cliente, cliente sem e-mail) para o que perde menos.

Antes de começar (testes 5 a 10, no seu computador):

```bash
colima start                 # se o Docker estiver parado
npm run dev                  # terminal 1
npm run dev:tick             # terminal 2 (o despertador; sem ele nada anda)
```

Mailpit (caixa de e-mails de mentirinha): http://localhost:8025.
Para os testes 1 a 4 você precisa de **chaves reais** (veja o `docs/PRIMEIROS_PASSOS.md`, Fase 9).

---

## 1. Pagamento real no AbacatePay 💰

**Por quê:** dinheiro. Recibo e "assinatura confirmada" só foram testados com o provedor de mentirinha (mock).

**Como:**
1. Configure `PAYMENT_PROVIDER=abacatepay`, `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET` (PRIMEIROS_PASSOS 9.7).
2. Cadastre o webhook no painel do AbacatePay: `https://SEU-ENDERECO/api/billing/webhook`.
3. Crie uma conta nova, escolha um plano e pague um PIX de **valor baixo** (ou use o modo de teste do provedor).

**Deve ver:**
- ✅ Chega "Assinatura confirmada" e o recibo, **1 vez cada** (não duas).
- ✅ Em Configurações > Assinatura o plano aparece ativo.
- ✅ O recibo mostra valor e data certos e diz "não é nota fiscal".

⚠️ Se o valor, a data ou os 4 últimos dígitos do cartão vierem vazios, o formato do evento do AbacatePay é diferente do que
assumimos. Me mande o corpo do webhook (sem a chave).

Linhas: grupo E do roteiro (refazer com provedor real) e 9.10 item 8.

---

## 2. E-mail real no seu Gmail 📧

**Por quê:** sem e-mail ninguém confirma conta, recebe convite nem recibo.

**Como:**
1. Configure Resend ou Azure (ACS) com **domínio verificado** (PRIMEIROS_PASSOS 9.5).
2. Crie uma conta com um e-mail seu de verdade.
3. Peça "esqueci minha senha" e convide uma segunda pessoa.

**Deve ver:**
- ✅ Chegam na **caixa de entrada** (não no spam): boas-vindas, confirmar e-mail, início do teste.
- ✅ Todos os links começam com o endereço de produção, **nunca** `localhost`.
- ✅ O remetente é do seu domínio (não `seu-email@gmail.com`).
- ✅ O link de redefinir senha funciona e chega o aviso "senha alterada".

Linhas: B9, J12 e 9.10 itens 3 a 6.

---

## 3. Isolamento entre clientes 🔒

**Por quê:** vazar dado de um cliente para outro é o pior erro possível.

**Como:**
1. Entre com a conta do Tenant A e abra uma campanha. Copie o endereço (`/campanhas/ID`).
2. Saia. Entre com o Tenant B (outra organização) e cole esse endereço.
3. Repita com `/configuracoes/assinatura` e com um criativo ou lead de A.

**Deve ver:**
- ✅ B recebe 404 ou "negado". **Nunca** vê dados de A.
- ✅ B não consegue cancelar nem mudar a assinatura de A.

🚨 Qualquer dado de A aparecendo para B é **bloqueante**: não abra ao público e me avise na hora.

Linhas: G7 e H8.

---

## 4. Busca real no Google Places 🗺️

**Por quê:** gasta dinheiro de verdade; o tipo de cobrança (SKU) ainda não foi confirmado.

**Como:**
1. **Antes**, no Google Cloud, ponha um **teto de gasto** (orçamento com alerta) e restrinja a chave.
2. Siga a Fase 8 do PRIMEIROS_PASSOS: `LEAD_SEARCH_ENABLED=true` e a chave em Configurações > Integrações.
3. Abra uma campanha como **dono** e clique **Buscar leads**. Depois **Buscar mais resultados**.
4. No dia seguinte, olhe o custo no Google Cloud.

**Deve ver:**
- ✅ Estado "rodando", e ao terminar "N novos, M duplicados".
- ✅ Leads novos em `/leads` (nome, telefone, site, endereço).
- ✅ "Buscar mais resultados" traz resultados **novos**, sem repetir.
- ✅ Custo: 1 a 2 chamadas pagas por clique. Anote o SKU cobrado e me diga.
- ✅ Sem a chave, o botão fica desabilitado com aviso (sem citar variável de ambiente).

Linhas: G1 a G3, G8, N2 a N4.

---

## 5. Cadastro limpo 🚪

**Por quê:** é a porta de entrada de todo cliente.

**Antes:** `npx prisma migrate deploy` e `npx prisma db seed` (cria o plano "Teste gratis"). Nunca `migrate dev`.

**Como:** janela **anônima**, abra `/signup`, use um e-mail novo e um **CPF de teste válido** (ex.: `529.982.247-25`), crie a conta e caia no dashboard. Confirme o e-mail no Mailpit.

**Deve ver:**
- ✅ O cadastro cria usuário **e organização** (teste grátis de 14 dias, sem cartão) e vai direto ao painel, sem tela de pagamento.
- ✅ O chip "Teste grátis: 14 dias" e o cartão "Como se chama a sua empresa?".
- ✅ Um segundo cadastro com o **mesmo e-mail ou CPF** cria a conta, mas **sem teste** (mensagem genérica na tela de assinatura).
- ✅ Você consegue criar um lead, uma sequência e uma campanha (dentro dos limites do teste).

Linhas: B1, B2, B4, bloco T.

---

## 6. Suspender uma organização ⛔

**Por quê:** se falhar, cliente inadimplente continua usando, ou cliente em dia fica bloqueado.

**Como:**
1. Entre como admin (`/admin/organizacoes`), abra uma org de teste e **suspenda**.
2. Entre com o dono dessa org e tente usar o app.
3. Volte ao admin e **reative**.

**Deve ver:**
- ✅ Suspensa: o tenant é bloqueado com aviso claro.
- ✅ Reativada: tudo volta a funcionar.
- ✅ A ação do admin fica registrada.

Linhas: A4, A6, B10.

---

## 7. E-mail não confirmado não envia mensagem ✉️🚫

**Por quê:** protege contra spam e cadastro falso. O envio deve ser **adiado**, não perdido.

**Como:**
1. Crie uma conta nova e **não** confirme o e-mail.
2. Tente aprovar um rascunho de mensagem. Deixe o `npm run dev:tick` rodando.
3. Depois confirme o e-mail e espere o próximo tick.

**Deve ver:**
- ✅ Aprovar mostra "confirme seu e-mail"; o rascunho **não** some.
- ✅ O tick adia o envio sem queimar tentativas.
- ✅ Depois de confirmar, o tick seguinte envia.

Linhas: J5, J6, J7.

---

## 8. Cancelar a assinatura 🧾

**Por quê:** mexe em cobrança e em acesso.

**Como:** em Configurações > Assinatura, como dono:
1. Plano pago em dia: **Cancelar assinatura** e confirme.
2. Em outra org com período vencido ou sem período: cancele também.
3. Com o cancelamento agendado, mande um evento do provedor dizendo que não há cancelamento (roteiro H10).

**Deve ver:**
- ✅ Em dia: **agendado**, a org continua usável até o fim do período, 1 e-mail.
- ✅ Vencido/sem período: **imediato**.
- ✅ O evento externo **não** desfaz o cancelamento agendado nem manda e-mail de "reativado".
- ✅ "Manter assinatura" desfaz e manda 1 e-mail.

Linhas: H9, H10.

---

## 9. LLM real (agentes de IA) 🤖

**Por quê:** os agentes dependem disso. Só foi testado com chave falsa.

**Como:**
1. Em Configurações > Integrações > "Provedor de LLM", use Gemini
   (`https://generativelanguage.googleapis.com/v1beta/openai`) ou Groq, com a chave do provedor. Ou só a chave da Anthropic (Claude).
2. Clique **Testar conexão** e depois **Simular** num agente.

**Deve ver:**
- ✅ O teste passa e o Simular mostra o provedor e o modelo usados.
- ✅ Se o provedor devolver "muitas requisições" (429), a tela não quebra e sugere uma instância própria (Ollama).
- ✅ Nenhuma chave aparece na tela ou no log.

Linhas: L5, L9 (e L2 para o Claude).

---

## 10. Teclado e modo escuro 🌙

**Por quê:** acessibilidade. Ninguém olhou as telas novas no escuro.

**Como:** no navegador, ligue o modo escuro do sistema e navegue só com o teclado.
- **Tab** pelo menu lateral e pelos botões; **Esc** em cada modal (cancelar assinatura, excluir conta).
- Visite: Configurações > Assinatura, Configurações > Conta, `/verificar-email`, `/conta/excluir/...`, a tela de convite.

**Deve ver:**
- ✅ O foco aparece sempre visível e a ordem faz sentido.
- ✅ O item da página atual fica destacado no menu.
- ✅ **Esc** fecha o modal (menos enquanto está enviando).
- ✅ Texto legível no escuro, sem texto claro sobre fundo claro.

Linhas: F3, H12.

---

## Uma decisão sua que aparece nos testes

**J11:** cadastro com um e-mail que **já existe** não envia e-mail, mas a tela responde diferente de um e-mail novo. Quem tenta
consegue descobrir que o e-mail tem conta. É assim desde a SPEC-049. Decida se quer resposta igual para os dois casos.

## Quando terminar

Marque os `[x]` no `docs/ROTEIRO_DE_TESTES.md`, anote o que falhou na coluna "Observado" e me mande o resumo.
Os prazos de guarda de dados (5 anos e 6 meses) ainda precisam de **parecer jurídico** antes de abrir ao público.
