# SPEC-034 — Billing/assinatura: frontend (pricing, checkout, gestao do plano)
- status: APPROVED (usuario, 2026-09-25) | domain: frontend | depende de: 033, 002, 027

## Objetivo
UI para o Provider escolher/trocar de plano e gerenciar a assinatura, mostrar o bloqueio quando a org estiver suspensa por billing, e permitir que um visitante novo (vindo da landing, SPEC-035) crie conta + assine sem intervencao humana (signup self-service).

## Escopo
- Configuracoes > Assinatura (novo item, mesmo padrao de aba usado em SPEC-018 "Configuracoes > Integracoes"): plano atual, status, proxima cobranca, botao "Gerenciar assinatura" (abre o portal do provedor, SPEC-033) e, se sem plano ativo, os cards de plano com abas mensal/anual (mesmos dados de `Plan` da SPEC-033).
- Fluxo de checkout (usuario ja logado, trocando de plano): seleciona plano/cadencia -> chama `createCheckoutSession` (SPEC-033) -> redireciona para o checkout hospedado do provedor -> retorno tratado (sucesso/cancelado) com toast e revalidacao do status da org.
- **Signup self-service** (decisao D-35-1, usuario 2026-09-25): nova rota publica `/signup` (fora do gate de `requireUser()`, mesmo route group publico da SPEC-035) — formulario minimo (nome, e-mail, senha, nome da empresa) -> cria `User` (`role: provider`/owner) + `Organization` nova (reusa o mesmo caminho de criacao 1:1 da migracao da SPEC-030) + inicia trial (`Subscription.status: trialing`, sem cobranca, D-33-3) -> loga o usuario -> redireciona para o checkout do plano escolhido (se veio da landing com plano pre-selecionado via query param) ou para `/dashboard` (se so quer comecar o trial e escolher depois). Reusa validacao/hash de senha ja existente em SPEC-009 (argon2), so adiciona o passo de criar Organization.
- Tela/banner de "assinatura pendente" quando `Organization.status !== "active"`: aparece em todo o app autenticado do Provider (banner persistente estilo `HealthBanner` ja existente, `src/components/layout/HealthBanner.tsx`) com CTA para regularizar, sem esconder o restante da navegacao (a menos que D-33-4 decida bloquear leitura tambem).
- Componentes de card de plano (preco, lista de limites/beneficios, badge "mais popular" se aplicavel) reaproveitados depois na landing (SPEC-035) — construir como componente compartilhado (`src/components/billing/PlanCard.tsx` ou similar) desde o inicio para nao duplicar entre area logada e landing publica.

## Fora do escopo
- Definicao dos planos reais (D-33-2 fechada com placeholder, SPEC-033).
- Pagina publica de pricing na landing (SPEC-035 reusa o componente, mas a pagina em si e outra SPEC).
- Convite de multiplos membros por org (D-30-4, adiada).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [ ] Provider ve plano atual/status/proxima cobranca; troca de plano funciona ponta a ponta ate o checkout hospedado (retorno tratado local, sem depender de rodar o provedor real em teste automatizado — mock/fixture do SDK).
- [ ] Banner de assinatura pendente aparece quando `status !== "active"` e some quando regularizada (revalidacao coerente com o resto do app).
- [ ] `/signup` cria User+Organization+trial e loga o usuario ponta a ponta (teste); e-mail duplicado da erro tipado, nao 500.
- [ ] `PlanCard` reutilizavel, acessivel, responsivo.
- [ ] build/lint/typecheck OK; validacao visual pendente se navegador indisponivel.

## Ordem de execucao
dev-frontend, apos 033 `IMPLEMENTED`.
