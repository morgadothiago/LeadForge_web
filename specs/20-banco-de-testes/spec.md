# SPEC-020 — Banco de dados separado para testes
- status: IMPLEMENTED (QA achou NEEDS_FIX na 018/APPROVED na 020; correcoes verificadas por testes 769/769, sem segundo QA; navegador, Evolution real e multi-instancia PENDENTES)| domain: backend/infra | depende de: SPEC-000, SPEC-001
## Problema (verificado)
`npm test` roda contra o banco de DEV (`leadforge`, porta 5434): deixou lixo (campanhas zz-test, SchedulerRun, Suppression), sujou dados do usuario e, desde a SPEC-018, os testes ESVAZIAM temporariamente `IntegrationSecret` e restauram no afterAll — se o teste travar, as chaves cadastradas pelo admin se perdem. Testes concorrentes de agentes tambem geraram falhas espurias no banco compartilhado.
## Escopo
- Banco `leadforge_test` no MESMO Postgres do Docker (5434), derivado do DATABASE_URL do `.env` trocando so o nome do banco (ou `TEST_DATABASE_URL` se definido). NUNCA o mesmo nome do banco de dev.
- `vitest.config.ts`: `test.env.DATABASE_URL` apontando para o banco de teste; `globalSetup` (src/test/global-setup.ts): cria o banco se nao existir (conectando ao banco de manutencao `postgres`), roda `prisma migrate deploy` SO nele e o seed idempotente SO nele; nao apaga o banco entre execucoes (velocidade), com script `npm run test:db:reset` (drop+create+migrate+seed do banco de TESTE, com trava que recusa qualquer nome que nao termine em `_test`).
- TRAVA DE SEGURANCA em setupFiles: antes de qualquer teste, se o nome do banco de `DATABASE_URL` nao terminar em `_test`, abortar a suite com erro claro (impede rodar testes contra dev/producao por engano). Teste dessa trava.
- Ajustar testes que dependem de detalhes do banco de dev: usuario admin do seed (signInAsSeedAdmin), seed com 20 leads etc., e remover o hack de snapshot/restore de `IntegrationSecret` (agora pode truncar a vontade no banco de teste; mantenha a limpeza por teste). Testes que executam SQL de migration/backfill rodam no banco de teste.
- Execucao segura em paralelo entre agentes: banco de teste unico e `fileParallelism: false` continuam; documentar que duas execucoes simultaneas de `npm test` ainda colidem (rodar uma por vez).
- `docs/CONFIGURACAO_POS_PROJETO.md`: secao sobre o banco de testes; remover o item "banco separado para testes".
## Extra pequeno (backend + 2 arquivos de UI)
Expor `role` em `CurrentUser`/`requireUser` (src/lib/auth/require-user.ts) e esconder a aba "Integrações" de nao-admin (SettingsTabs e layout de configuracoes) mantendo a checagem real no servidor (`requireAdmin`).
## Criterios de aceite
- [x] `npm test` completo passa 2x e NAO altera uma unica linha do banco de dev (contagens de tabelas do dev identicas antes/depois: leads, campaigns, touches, suppressions, webhook events, scheduler runs, integration secrets, user).
- [x] Trava: com DATABASE_URL de dev a suite aborta com mensagem clara (teste).
- [x] `globalSetup` cria/migra/semeia o banco de teste do zero (verificar com `test:db:reset`) e nunca toca o de dev.
- [x] Testes de IntegrationSecret nao esvaziam mais nada do dev.
- [x] `role` em CurrentUser; aba oculta para nao-admin; requireAdmin continua sendo a barreira.
- [x] typecheck/lint OK; docs atualizados.

## Implementation Notes
- status: IMPLEMENTED
- Arquivos: vitest.config.ts; src/test/{db-guard,db-admin,global-setup,setup-guard}.ts; src/test/db-guard.test.ts; src/scripts/{test-db-reset,db-counts}.ts (db-counts: leitura); package.json (`test:db:reset`); src/lib/actions/integration.test.ts (snapshot/restore removido); src/lib/auth/require-user.ts (+`role`) e auth.test.ts; src/components/settings/SettingsTabs.tsx e src/app/(app)/configuracoes/layout.tsx (`isAdmin`); docs/CONFIGURACAO_POS_PROJETO.md.
- Resultados: `npm test` 56 arquivos / 689 testes, 2 execucoes seguidas OK; contagens do dev identicas antes/depois; trava verificada (aborta com mensagem, sem vazar credenciais); `test:db:reset` OK e recusa `leadforge`; typecheck e lint limpos.
- Decisoes: `test.env.DATABASE_URL` injeta a URL nos workers; `dotenv/config` nao sobrescreve; a trava roda em setupFiles e tambem no globalSetup antes de conectar; seed roda como processo filho com DATABASE_URL so no env do filho.
- Limitacoes: duas execucoes simultaneas de `npm test` colidem; aba oculta e so UX (barreira real: requireAdmin).

## Implementation Notes — Correcoes de QA (2026-09-19)
- B4: alem de o nome terminar em `_test`, o banco de teste precisa estar no MESMO host:porta do `DATABASE_URL` de dev, ou o operador confirma com `TEST_DB_ALLOW_OTHER_HOST=1` (exatamente "1"). `assertSameServerOrConfirmed` em `src/test/db-guard.ts`, chamado em `src/test/global-setup.ts` e `src/scripts/test-db-reset.ts`; mensagem nunca traz credenciais. Teste em `src/test/db-guard.test.ts` (outro host com nome `*_test` -> recusa). Sem `DATABASE_URL` de referencia nao ha o que comparar (passa).
