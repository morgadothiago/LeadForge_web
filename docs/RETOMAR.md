# Para retomar: o que está pronto, o que está bloqueado e o que depende de você

Criado em 2026-10-10 (noite), antes de você dormir. **Este arquivo é atualizado quando as tarefas em andamento terminam**
(ver "Estado final" no fim). Branch de trabalho: `docs/retomar-merge-feito` (a `main` já tem as SPECs 048-058). Repo: git@github.com:morgadothiago/LeadForge_web.git.

## 1. Como conferir o estado em 1 minuto

```bash
git log --oneline -10 && git status --short   # o que foi commitado / o que sobrou
npx tsc --noEmit                              # deve estar limpo
npx prisma migrate status                     # deve dizer "up to date"
```

Ambiente local: Postgres/Redis/Mailpit no Docker (`colima start` se `docker ps` falhar), `npm run dev`, e **`npm run dev:tick`
em outro terminal** (sem ele criativos ficam em "Na fila"). Mailpit: http://localhost:8025.

## 2. Em andamento

SPEC-053 (053a backend + 053b frontend) IMPLEMENTADA e aprovada pelo QA em 2026-10-10, **sem commit ainda** (sem migration; testes em `leadforge_053_test`: 152 arquivos/1896 testes). SPECs 053-056 APROVADAS (decisões D-053-x etc. registradas nas SPECs). Próximas: 054, 055, 056 (uma por vez). Achados baixos do QA da 053: (1) evento do provedor com `cancelAtPeriodEnd:false` após agendamento desfaz o cancelamento e manda e-mail de reativação (renovação de cartão AbacatePay); (2) modal decide "imediato" só por trial/sem período, a action também por período vencido/incomplete; (3) cartão AbacatePay pode continuar cobrando até cancelar no painel do provedor (sem endpoint, D-053-5). Antes: SPEC-057 (sidebar) e SPEC-058a/b (busca sob demanda) concluídas e na `main`.

Regra combinada: **só commitar quando tudo estiver verde** (tsc, lint sem erros, vitest em banco `*_test` novo, QA aprovado).

## 3. Decisões que SÓ VOCÊ pode tomar (bloqueiam trabalho)

| # | Decisão | Bloqueia | Minha recomendação |
|---|---|---|---|
| 1 | ~~Aprovar SPEC-052b~~ **FEITO**: 052b (parte sem cartão) implementada, sem commit ainda. Falta aplicar a migration `20261013120000_billing_reminder_kinds_052b` no banco de dev (`npx prisma migrate deploy`) e validar o bloco E | -- | -- |
| 2 | **Q-052-5**: nomes dos eventos de falha/recuperação de cartão do AbacatePay (precisa da doc/sandbox do provedor) | 052b só na parte de cartão (mapear eventos de falha/recuperação de cartão; sem isso a régua de cartão só dispara pelo estado/grace via job) | Pesquisar na doc do provedor |
| 3 | ~~Aprovar~~ **FEITO (2026-10-10)** **SPEC-053** (cancelamento/reativação), **054** (exclusão de conta LGPD), **055** (verificação/segurança de cadastro), **056** (e-mails de organização) | cada uma delas | Responder as 5 decisões de e-mail abaixo |
| 4 | ~~**5 decisões de e-mail**~~ **DECIDIDAS com a recomendação (2026-10-10)**: (a) cancelamento: acesso até fim do período ou imediato? reembolso? (b) exclusão de conta: soft ou hard, em quantos dias? (c) recibo: só e-mail informativo (já assumido) (d) régua de cartão e PIX igual (já assumido) (e) verificação de e-mail: obrigatória antes de usar ou só aviso? | 053-056 | (a) até fim do período, sem reembolso proporcional; (b) soft delete 30 dias e depois purga; (e) obrigatória para enviar mensagens, não para entrar |
| 5 | **Provedor de avatar real** (Q-051-1: HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar) | criativos reais (hoje só mock) | Escolher 1 e abrir SPEC; antes cumprir D-051-15 (SSRF/timeouts) |
| 6 | **Q-051-11**: teto de retentativas dos criativos | ajuste fino | Aceitar o default |
| 7 | **Drift `20260928*`** (CPF/CNPJ, trial, AbacatePay): importar essa feature ou remover as colunas do banco de dev? | limpeza de migrations; o aviso "nunca `migrate dev`" continua até lá | Decidir se a feature existe; se não, remover só no banco de dev, com backup |
| 8 | **Rate limit persistente** (D-049-14): hoje em memória, não vale entre instâncias | produção multi-instância | SPEC própria (Redis/Postgres) antes de escalar |
| 9 | **LLM grátis**: SPEC-036 está aprovada mas **não implementada** (adapter OpenAI-compatível: Groq/OpenRouter/Ollama/Gemini) | agentes de IA sem custo | Implementar a 036 |
| 10 | ~~**Q-052-6**~~ **decidido: separado**: `trial-started` separado das boas-vindas (SPEC-055) ou um e-mail só? (assumi separado) | 055 | Revisar quando aprovar a 055 |
| 11 | ~~Abrir o Pull Request~~ **FEITO** (PR da branch `docs/retomar-merge-feito`; o merge é seu) | -- | -- |
| 12 | **Paginação da busca Places** (`nextPageToken`/rotação de keywords): hoje 1 página de até 20 e repetir dá duplicados | qualidade da captação | SPEC separada depois da 058 |

## 4. O que só funciona com você (chaves, contas, navegador)

- **Telas logadas:** 33 itens foram exercitados em navegador real por Claude (seção 7, sem vazamento entre tenants). Falta o seu olhar
  em dark mode, teclado/leitor de tela e no formulário de nova campanha (`docs/ROTEIRO_DE_TESTES.md`).
- **Google Places / Maps**: criar chave (Fase 8 do PRIMEIROS_PASSOS), `LEAD_SEARCH_ENABLED=true`, cadastrar em
  `/configuracoes/integracoes`. A busca nunca rodou com a API real; o SKU cobrado não foi confirmado; defina teto de orçamento no Google.
- **Azure (ACS e Blob), Resend, AbacatePay, Evolution, Claude**: só testados com mocks. Valide o recibo com webhook real/sandbox do
  AbacatePay (campos `amount`, `paidAt`, `card.lastDigits` foram assumidos).
- **Produção (Vercel)**: definir `CRON_SECRET` (cron por minuto já está no `vercel.json`; exige plano pago, no Hobby só 1x/dia),
  `TRUSTED_PROXY_IP_HEADER` (obrigatória em produção), envs de e-mail e storage. Sem `CRON_SECRET` nada avança (sequências, criativos, busca).

## 5. Riscos conhecidos (não bloqueiam, mas não esqueça)

- 052a: se o provedor de e-mail falhar na hora do envio, aquele e-mail **se perde** (chave de idempotência reservada antes; sem retry).
- 052a: o signup espera o envio do e-mail de trial antes de criar a sessão (SMTP lento atrasa o cadastro).
- 052a: `EmailDispatchLog` sem purga; falta teste de integração das actions `signUpAndStartCheckout`/`createOrganization` chamando o trial.
- Troca de plano: e-mail restaurado na 052b (regressão D-046-3 resolvida).
- 052b: ~~D+7 coincidia com a suspensão~~ **resolvido**: o "Último aviso" agora sai em D+6 (D-052-11).
- 052b: o e-mail de falha de cartão no AbacatePay não existe (Q-052-5); a régua de cartão só começa quando algo coloca a assinatura em past_due.
- Termos da Places API restringem cache/armazenamento de dados: confirme antes de operar em escala.
- `.storage/` (arquivos locais) e `.env` não vão para o git (conferido).

## 7. Achados do teste E2E em navegador real (2026-10-10, feito por Claude com Brave + Playwright)

Resolvidos em 2026-10-10 (3ª rodada): itens 1 e 6. Item 2 mantido como está (ver nota). Demais dependem de você.

Contas de teste no banco de dev: `claude.a*@testes-claude.local` (senha de teste `SenhaForte-12345`, **só dev**). Dados de teste: orgs
"Empresa A ...", "Segunda Org Teste", criativos e lead "Lead Secreto do Tenant A". Podem ser apagados.

**Corrigido nesta rodada**
- **Bug real (commitado):** no wizard de criativos, 1 clique em "Continuar" no passo Formato **enviava o criativo na hora**, pulando a
  revisão (o botão "Continuar" e o de enviar eram o mesmo elemento React; ele virava `type=submit` no meio do clique). Corrigido com `key`
  distintas em `CreativeWizard.tsx`. Os testes SSR não pegavam isso: só navegador real.
- **Servidor de dev desatualizado:** o `npm run dev` iniciado antes das migrations/código da 052a guardava o Prisma Client antigo e o
  e-mail de trial **não saía** (sem erro visível). Depois de reiniciar, saiu. **Sempre reinicie o dev server após `migrate deploy`.**

**Passou** (detalhes na coluna "Observado" do `docs/ROTEIRO_DE_TESTES.md`): A1-A3, B5-B7, C1-C2, C4-C7, C9-C11, D1-D2, D4, E1-E4, E6-E10, F1-F2, F4-F6.
Isolamento entre tenants (B5, B6, C2, C11, D4): **sem vazamento**.

**Pontos de atenção (decisão sua, nenhum quebra o sistema)**
1. **~~D+7 contraditório~~ RESOLVIDO (D+6, D-052-11).** Era: com grace de 7 dias, o "Último aviso: sua conta será suspensa" e o "Sua conta foi suspensa" chegam **no mesmo tick**.
   Sugestão: último aviso em D+6, ou suspender só em D+8.
2. **Remover membro com sessão aberta (mantido: trocar a org na sessão exigiria escrever cookie dentro de `requireUser`, que é leitura; risco maior que o ganho):** o removido vai para `/login` (perde a sessão), não cai na organização própria. Funciona e é seguro; só é
   menos gentil que "trocar para a org restante". Decidir se vale ajustar.
3. **URL do vídeo é assinada e pública até expirar:** qualquer pessoa com o link baixa o vídeo (200 sem login), como a SAS do Azure. É o desenho da
   SPEC-050; só garanta que a expiração seja curta em produção.
4. **Remetente dos e-mails** em dev sai de `seu-email@gmail.com` (placeholder do `.env`). Configure `ACS_FROM_*`/`RESEND_FROM_*`/`SMTP_FROM` reais.
5. **Mailpit poluído:** os testes automatizados também enviam e-mail ao Mailpit (400+ mensagens `zz-*@test.local`). Pesquise pelo destinatário.
6. ~~Convite com e-mail errado mostrava o e-mail convidado~~ **RESOLVIDO**: agora mascarado (`o***a@dominio`, `maskEmail`).
7. O formulário de **nova campanha** na interface não foi exercitado por mim (o seletor "Criar novo" do ICP não respondeu à automação): teste à mão.

**Não testado** (precisa de você/chaves): Places real (bloco G), Gmail/Resend/ACS reais, AbacatePay real, recibo de renovação por webhook HTTP real
(chamei `processBillingEvent` direto), dark mode, leitor de tela, teclado completo.

## 6. Estado final (2026-10-10, madrugada)

- **Tudo commitado e no GitHub** na branch `feat/specs-048-051` (último commit da 052b: `019f3e4`): SPECs 048, 049 (a/b), 050, 051 (a/b),
  052a, 052b (sem cartão), 057 e 058 (a/b), mais docs. Migrations aplicadas no banco de dev: todas, até `20261013120000`.
- **Verificação final:** `tsc` limpo; lint 0 erros (14 warnings antigos); vitest completo em banco novo: 150 arquivos, 1868 testes.
- **MERGE FEITO:** PR #1 mergeado na `main` em 2026-10-10 (commit `7da5ef0`, mergeado por você com `gh pr merge 1 --merge`). A `main` tem tudo: SPECs 048-052b, 057, 058.
- **Falta validar com você:** blocos D, E (E6-E11 só após a migration, já aplicada), F e G do `docs/ROTEIRO_DE_TESTES.md`.
- **Próximo trabalho** depende das decisões da seção 3 (Q-052-5 cartão AbacatePay, 053-056, avatar real, LLM grátis SPEC-036, drift, rate limit persistente).
