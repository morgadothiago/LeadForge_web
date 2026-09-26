# SPEC-035 — Landing page publica ("/")
- status: APPROVED (usuario, 2026-09-25) | domain: frontend | depende de: 002 (design system), 027 (sidebar shadcn), 034 (para a secao de pricing real e para o /signup — hero/features podem comecar antes)

## Objetivo
Redesenhar a rota raiz (`/`) como landing page de marketing, publica e deslogada, no lugar do redirect atual para `/dashboard`. Direcao visual: estetica SaaS fintech limpa, mesmo nivel de polish de um dashboard de referencia (descrito abaixo pelo usuario, dev-frontend nao tem acesso a imagem).

## Contexto
Hoje `src/app/(app)/page.tsx` so redireciona `/` -> `/dashboard`, e `(app)/layout.tsx` exige `requireUser()` para **toda** rota do grupo `(app)`, incluindo `/`. Ou seja, hoje `/` nunca e alcancavel deslogado (cai em `/login` antes mesmo do redirect fazer sentido). Isso precisa mudar de arquitetura de rotas, nao so de conteudo.

## Direcao visual (descrita pelo usuario, referencia por imagem que o dev-frontend nao ve)
Estetica SaaS fintech limpa: fundo claro, cards arredondados (`rounded-2xl`) com sombra suave, cor primaria roxo/indigo (tom ~`#6D5EF5`), chips de variacao percentual em verde/vermelho (ex.: "+12%"/"-3%"), elementos tipo donut chart/grafico de linha como motivo visual recorrente, tipografia sans limpa, nav superior com estado ativo em pill escuro, avatar circular no canto. Objetivo: comunicar "produto B2B de prospeccao com dados/IA", adaptado para landing (hero + features + pricing em abas + prova social + CTA + footer) — nao e um dashboard, e marketing com essa linguagem visual. Reaproveitar/estender o design system existente (SPEC-002, ja migrado para shadcn na SPEC-027) em vez de recriar tokens do zero — se a cor primaria atual do design system nao for esse tom de roxo/indigo, o dev-frontend propoe o ajuste de token (nao cria uma paleta paralela so para a landing).

## Escopo
### Arquitetura de rotas
- `/` deixa de redirecionar; vira uma pagina publica fora do gate de `requireUser()`. Isso exige mover o grupo autenticado: opcao recomendada — landing fica em um novo route group `(marketing)` (ou direto em `src/app/page.tsx` fora de qualquer grupo autenticado) com layout proprio (sem sidebar/header do app), e o dashboard, que hoje "e" a raiz logicamente, continua acessivel em `/dashboard` (rota que ja existe, SPEC-004) — ou seja, nao muda URL de nada que ja funciona logado, so para de existir o redirect de `/` para `/dashboard`.
- Usuario ja autenticado que acessa `/`: redireciona para `/dashboard` (UX padrão de SaaS — evita mostrar a landing para quem ja e cliente). Usuario deslogado que acessa `/dashboard` ou qualquer rota do `(app)`: continua indo para `/login` como hoje (`(app)/layout.tsx` nao muda esse comportamento).
- `/login` continua existindo como esta.

### Secoes da pagina
1. **Nav superior**: logo, links de ancora (Produto/Recursos, Precos, Sobre), CTA "Entrar" (-> `/login`) e "Comecar" (-> `/signup`, SPEC-034, com plano pre-selecionado via query param quando vem do card de pricing) — nav com estado ativo em pill escuro conforme a referencia.
2. **Hero**: titulo/subtitulo de valor (prospeccao B2B automatizada com IA), CTA primario, e um elemento visual estilo "card de dashboard" (donut/linha, numeros com chips de variacao %) ilustrando o produto — usar dados ilustrativos estaticos, nao conectados a dado real.
3. **Features**: grid de cards `rounded-2xl` com sombra suave, icones (`lucide-react`, ja instalado), destacando: campanhas + ICP, sequences multi-canal, WhatsApp, busca de leads por IA, agentes de IA (SDR/Follow-up/Closer), pipeline Kanban, calendario/reunioes — mapeado 1:1 com o que o produto ja faz (specs 004-029), sem prometer nada que nao existe.
4. **Pricing**: abas mensal/anual reaproveitando o `PlanCard` construido na SPEC-034, alimentado pelos planos `starter`/`pro`/`business` de D-33-2 (precos placeholder, aviso claro no relatorio de entrega de que precisam confirmacao antes do launch); card do plano CTA -> `/signup?plan=<key>&cadence=<monthly|yearly>` (exceto `business`, que aponta pra contato/vendas, nao checkout).
5. **Prova social**: omitida por enquanto (D-35-2) — produto sem clientes/depoimentos reais documentados, sem fabricar. Reservar o espaco/componente (`SocialProofSection`) vazio ou com metricas agregadas genericas do produto (ex. "campanhas rodando 24/7"), nunca logo ou depoimento de cliente inventado.
6. **CTA final** + **footer** (links institucionais, redes, copyright).

### Design system
- Reaproveita tokens/componentes do design system (SPEC-002/027): `Button`, `Card`, cores, tipografia, `tailwind-merge`, `framer-motion` para microinteracoes sutis (fade/slide ao rolar, hover em card) — sem exagero, mantendo o tom "produto serio", nao "site de landing generico".

## Fora do escopo
- Conteudo/copy final definitivo (dev-frontend escreve um copy placeholder profissional; ajuste fino de texto e algo o usuario revisa depois).
- Blog, changelog, paginas institucionais alem do necessario para o footer.
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-25)

D-35-1: CTA "Comecar" leva para `/signup` (SPEC-034), nao para `/login`. Signup self-service (cria User+Organization+trial) passa a fazer parte do escopo da SPEC-034, nao e SPEC futura.

D-35-2: Prova social omitida por enquanto — sem depoimento/logo fabricado. Espaco reservado, pode usar metrica agregada generica do produto, nunca cliente nominal inventado.

## Criterios de aceitacao
- [ ] `/` publico, sem `requireUser()`, renderiza a landing completa (nav, hero, features, pricing, prova social conforme D-35-2, CTA, footer).
- [ ] Usuario autenticado acessando `/` e redirecionado para `/dashboard`; `/dashboard` e demais rotas `(app)` continuam exigindo login como hoje.
- [ ] Pricing consome os planos reais (ou sinaliza claramente dado de teste se D-33-2 nao tiver sido aprovada ainda).
- [ ] Responsivo (mobile-first: nav vira menu, grid de features empilha, pricing tabs acessiveis por teclado), contraste AA, sem regressao de performance perceptivel (imagens otimizadas, sem libs novas pesadas).
- [ ] build/lint/typecheck OK; validacao visual pendente se navegador indisponivel (mesmo padrao das SPECs anteriores).

## Ordem de execucao
dev-frontend. Estrutura/hero/features podem comecar assim que 002/027 (ja `IMPLEMENTED`) estiverem de pé — nao esperam 030-034. A secao de Pricing (CTA -> `/signup`) so fecha depois de 034 `IMPLEMENTED`; ate la, marcar Pricing como PENDENTE com dado de teste explicito no relatorio.
