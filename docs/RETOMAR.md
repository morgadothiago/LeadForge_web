# Para retomar: o que está pronto, o que depende de você e o que vem depois

Atualizado em 2026-10-13 (069d na main; 069e revisão final feita, sem commit). **A seção 0 abaixo manda; as seções 1 a 8 são histórico detalhado e podem estar desatualizadas (cheque o `git log`).**

## 0. RETOMAR: leia isto primeiro (2026-10-13, madrugada)

### Onde paramos (2026-10-13, madrugada)
- **`main` = `fa47b53`** (069d; 069c frontend em `1a934ff`), igual no GitHub e no local (só `next.config.ts`, `.claude/` e `skills-lock.json` ficam de fora; a 069e está só no working tree, sem commit). Cada merge na `main` **publica sozinho** na Vercel (`https://lead-forge-web-omega.vercel.app`; as migrations aditivas rodam no build).
- **SPEC-065 (Free de 14 dias, um trial por e-mail OU CPF/CNPJ):** IMPLEMENTADA e na `main` (`65045a4`), QA aprovado. **Falta o teste ponta a ponta no navegador** (bloco T do ROTEIRO) para virar IMPLEMENTED. Em produção `TRIAL_CLAIM_PEPPER` já está na Vercel (arquivo `~/.leadforge-secrets/trial_claim_pepper.txt`; **não perder nem trocar**).
- **SPEC-066 (Assinatura: lista de mensalidades + PIX no checkout):** APROVADA. **066a (backend `BillingCharge`) na `main`** (`894f4f1`). **066b (checkout PIX) e 066c (UI da lista de mensalidades e card do Free) ainda não feitas.**
- **SPEC-067 (toasts padronizados com erro do backend):** DRAFT, aguardando `APROVAR SPEC-067` (Q-067-1..3, recomendação: sim). Roda depois da 066c.
- **SPEC-068 (caixa de atendimento de WhatsApp, `/atendimento`):** APROVADA em 2026-10-12 com todas as recomendações. **068a backend (`5a3cd15`) e 068b frontend (`6f1ee52`) na `main`**, ambas com QA aprovado com ressalvas e corrigidas (tsc/eslint/vitest 2699 testes verdes). **Falta:** E2E em navegador (bloco V do ROTEIRO: 390/1280 px, claro/escuro, teclado), `next build` com o dev parado (confirmar que não volta o erro do `dns`), validar a Evolution v2.1.1 de verdade (`fromMe`, status `read`, ordem do eco), e as etapas **068c/d (anexos)** e **068e (etiquetas/extras; limpar bolha `sending` presa)**. Decisão aceita: FK da instância em `Cascade` (excluir número apaga a caixa dele; a UI avisa).
- **SPEC-069 (agentes/integrações pelo admin + funcionalidades por plano Free/Starter/Pro):** APROVADA em 2026-10-13 (Q-069-1: `platform_admin` configura e o tenant só usa; Q-069-2: a plataforma paga a IA e o BYOK fica desligado; Q-069-4: matriz aprovada, valores PLACEHOLDER em `src/lib/billing/plan-catalog.ts`).
  - **069a** (módulo `entitlements`, matriz, override por org) na `main` (`465c5c6`, QA aprovado).
  - **069b** (bloqueios no servidor em agentes, integrações, fontes, caixa, criativos, equipe, sequências, busca, e-mail e envios/dia; downgrade/past_due sem apagar; teste de cobertura) na `main` (`3f32a6b`, QA aprovado, 214 arquivos / 2990 testes).
  - **069c backend** (6 actions de admin por organização: override com motivo/validade, política de agente, kill switch com `lockedByAdmin`, chave da plataforma por org; auditoria; tenant somente leitura; correções do QA 069b): QA aprovado, **ENVIADO ao GitHub/produção em 2026-10-13 (`a87447c`; deploy Vercel Ready, migration+seed rodaram)**. Janela de risco até a 069c frontend existir: tenants sem chave de plataforma ficam sem Places/WhatsApp (só o admin grava) e, sem `PLATFORM_LLM_API_KEY` na Vercel, quem usava chave própria fica sem IA. **069c frontend** (4 abas em `/admin/organizacoes/[id]`: Agentes e IA, Integrações, Plano e features, Auditoria) IMPLEMENTADA e já commitada (`1a934ff`, docs em `c409632`); o QA dela apontou M1/B1/B2, corrigidos abaixo; falta testar no navegador (390/1280 px, claro/escuro). **069d (UI do tenant) IMPLEMENTADA em 2026-10-13 (sem commit), junto com as correções M1/B1/B2 do QA da 069c frontend:** bloqueios com explicação e upgrade, campos de política somente leitura, chaves da plataforma "Gerenciada pela plataforma", medidores de IA/agentes/criativos/equipe, aviso de teto de IA 80%/100% (faixa para o owner), comparativo de planos (assinatura e landing) gerado do catálogo, `plan_feature_locked`/`policy_admin_only`/`policy_locked` no catálogo de erros e `plan.key` removido de `src/components` (ver "Implementation Notes 069d" na SPEC). Gates: `tsc` limpo, `eslint` 0 erros, `vitest` 224 arquivos / 3086 testes verdes em banco novo `leadforge_069d_final_test`. **Próximo passo: QA independente da 069d + correções M1/B1/B2 (um commit), teste no navegador (bloco X, X13-X35), depois 069e (revisão final, E2E, docs).**
  - **069d QA aprovado (2026-10-13), sem bloqueador.** Baixos para a 069e: `aiBudget` vai como prop a membros em `configuracoes/agentes/page.tsx` (passar só ao owner); "Testar conexão"/`lastTestError` visíveis ao tenant em chave da plataforma (`IntegrationCard.tsx`); texto de 100% do teto sempre diz "Faça upgrade". Falta E2E em navegador (390/1280 px, claro/escuro) e `next build`.
  - **069e (revisão final, 2026-10-13, SEM commit):** corrigiu os 3 baixos do QA 069d (`aiBudget` só ao owner via `aiBudgetForViewer`; chave da plataforma sem "Testar conexão"/`lastTestError` no tenant; texto de 100% do teto: upgrade x "fale com o suporte" quando o teto vem de override, `AiBudgetView.capFromOverride`), com testes. Tabela AC-1..AC-8 na "Implementation Notes 069e" da SPEC: AC-2/3/4/5/6 PASS automatizados; AC-1, AC-7 e AC-8 **PARCIAIS** (falta navegador 390/1280 px claro/escuro/teclado e `next build`). Gates em banco novo `leadforge_069e_test` (já dropado): `tsc` limpo, `eslint` 0 erros, `vitest` 225 arquivos / 3091 testes verdes. **SPEC-069 segue IN_PROGRESS: só vira IMPLEMENTED depois do seu E2E.**
  - **Próximos passos (069):** (1) commitar a 069e (sem `next.config.ts`, `.claude/`, `skills-lock.json`); (2) VOCÊ: `npx prisma migrate deploy` (migration `20261023120000_admin_policy_069c`) + `npx prisma db seed` no dev e reiniciar o `npm run dev`; (3) E2E no navegador: ROTEIRO bloco X (X1-X42; roteiro curto ao fim do bloco), 390/1280 px, claro/escuro; (4) `npm run build` com o dev parado; (5) com tudo ok, marcar 069 IMPLEMENTED nos specs.
  - **Falta (antigo):** QA/commit/push da 069d já feitos (`fa47b53`). Pendências da 069d: não olhada no navegador (390/1280 px, claro/escuro, teclado); aviso de teto de IA só em tela (sem e-mail/push); `member` ainda edita conteúdo de agentes (Q-069-11). Aplicar no dev: `npx prisma migrate deploy` (migration `20261023120000_admin_policy_069c`) e `npx prisma db seed`; sem `PLATFORM_LLM_API_KEY` as orgs sem `llm.byok` ficam sem IA.
  - **Atenção:** o Free tem **0 criativos por mês**; no dev local há um override de 7 dias (20 criativos) para a organização de teste. Depois de aplicar migrations em qualquer banco, rodar `npx prisma db seed` para gravar a matriz nos planos (Starter e Pro sem `features` ficam fail-closed em IA e fontes).
- **SPEC-070 (spike do provedor de vídeo com avatar):** APROVADA em 2026-10-13. Modelo e roteiros em `docs/SPIKE_PROVEDOR_AVATAR.md`. **SPEC-071 (adaptador `did`) e SPEC-072 (UI de criativos com provedor real):** DRAFT, só depois da 070. O provedor real de criativos ainda não existe: só o `mock`.
- **Criativos (SPEC-051c):** o mock agora serve MP4 reais (avatar **Luciana (mock)** = clipe de 20 s gerado no Magic Hour; os demais avatares, um vídeo de demonstração). Em dev o criativo só fica pronto se algo processar a fila: `npm run creatives:dev` (worker só de criativos; não envia nada). **Magic Hour (teste):** chave em `~/.leadforge-secrets/magichour_api_key.txt`; os créditos grátis acabaram (~5 restam; AI Talking Photo custa 20-48 créditos/s e a conta grátis não tem uso comercial); o Magic Hour anima uma foto com um áudio que VOCÊ manda (o gerador de voz dele não tem português). **A chave foi colada no chat: apagar em API Keys do painel e criar outra.** Voz masculina em PT-BR boa ainda não resolvida (vozes masculinas do macOS ruins; ElevenLabs foi sugerido).
- **Fora do escopo:** app móvel (SPECs 021-023 ficam no código, sem manutenção). **n8n:** zerado e **rodando** em `http://localhost:5678` (volume e banco recriados em 2026-10-13 por chave de criptografia divergente; precisa criar o usuário dono no primeiro acesso); só os 2 workflows de exemplo (`tick.json`, `ingest-leads-example.json`) reimportados, **inativos**. Decisão: agentes continuam dentro do app (n8n só como conector opcional; microserviços fora de escopo). Os agentes de IA rodam dentro do app (tick).
- **Prompt pronto (não executado):** `docs/PROMPT_ADMIN_NOTIFICACOES_SIDEBAR.md` (sino do admin + sidebar de admin).

### Ambiente local de hoje (para continuar os testes de WhatsApp)
- Dev com migrations até `20261022120000_entitlement_override_069a` aplicadas (e `db seed` rodado), `npm run inbox:backfill` rodado (1 conversa). Conta de teste `tifob60233@herclan.com` marcada como e-mail verificado **só no banco local** (o e-mail de confirmação não sai no dev).
- **Túnel do dia:** `https://arg-mass-estate-indexed.trycloudflare.com` (muda a cada vez que o `cloudflared` reinicia; atualizar `AUTH_URL`/`APP_BASE_URL` no `.env`, reiniciar o dev e recadastrar o webhook do AbacatePay). Webhook de dev atual: `webh_dev_jkCND6LXt3X4a3CHJKQ20xhw` (a API usa o campo `endpoint`, não `url`; **apagar é `POST /v2/webhooks/delete?id=`**).
- **Evolution (`localhost:8080`):** instância `vendas` **conectada** (número 11 97027-0208), webhook apontando para o túnel (token igual ao do banco). `lf-teste` parada em `connecting` (pode apagar). Se o container cair, é o Postgres que não estava pronto: `docker compose up -d evolution`.
- **Envio de teste funcionou** (app -> WhatsApp do lead Leonardo cardoso, +55 19 98178-1399). **Falta testar o caminho de volta:** o lead responder e a resposta entrar no app e em `/atendimento`.
- **Aprendizados do teste:** (1) campanha precisa de **sequência com passo WhatsApp** + **template com canal WhatsApp** (da mesma campanha); (2) o envio só sai **seg-sex, 9h-12h e 14h-17h** (fuso do lead, sem feriados; 12/10 foi feriado), então para testar fora do horário muda-se o fuso do lead no banco local (ex.: `Pacific/Auckland`) e volta depois; (3) o lead é único por (campanha, telefone) e só há **1 toque por lead+passo**: para repetir o teste crie **outra campanha** (use "Duplicar") ou outro lead; (4) o tick não roda sozinho no local: `POST /api/cron/tick` com `Authorization: Bearer $CRON_SECRET`.


### Pendências SUAS (nada disso eu consigo fazer sozinho)
1. **Webhook de produção no AbacatePay** (dev mode/Sandbox ligado; é um 2º webhook, ao lado do local): URL em `~/.leadforge-secrets/prod_webhook_url.txt` (copiar com `pbcopy < arquivo`), Secret em `~/.leadforge-secrets/prod_webhook_secret.txt`. Eventos: `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled`, `transparent.completed`.
2. **E-mail real em produção** (Resend ou Azure ACS com domínio verificado; ver `docs/PRIMEIROS_PASSOS.md` Fase 9.5). **Sem isso, na Vercel ninguém verifica o e-mail e ninguém paga** (a 062 exige e-mail verificado para pagar). Hoje o teste completo só funciona local.
   - **Diagnóstico (2026-10-12):** a Vercel tem `SMTP_*` apontando para o Gmail e o log de produção mostra `EAUTH 535 5.7.8 Username and Password not accepted` (o Gmail exige Senha de app; o valor de exemplo/senha normal é recusado). O cadastro funciona, mas nenhum e-mail sai (falha só vai para o log).
   - **Decidido:** usar o domínio `coest.me` (DNS no **HostGator**, cPanel > Editor de Zona) com o **Resend**. Passos: (1) conta no resend.com > Domains > Add Domain `coest.me`; (2) criar no Editor de Zona do HostGator os registros que o Resend mostrar (DKIM `resend._domainkey`, e MX/SPF no subdomínio `send`; **não mexer** nos MX/SPF existentes do domínio); (3) Verify; (4) API Keys > Create (Sending access) e gravar com `bash ~/save_resend_key.sh` (script já existe; grava em `~/.leadforge-secrets/resend_api_key.txt`); (5) pedir ao Claude para gravar na Vercel (Production) `RESEND_API_KEY`, `RESEND_FROM_NOREPLY=noreply@coest.me`, `RESEND_FROM_SUPPORT=suporte@coest.me`, `RESEND_FROM_BILLING=cobranca@coest.me` e refazer o deploy; conferir no log que não há `EAUTH`.
   - **Atalho só para testar:** SMTP do próprio HostGator (`mail.coest.me`, porta 465/587, usuário `thiago@coest.me`, senha da caixa); pior entrega e limite de envio. Ou Gmail com Senha de app (`bash ~/save_smtp_pass.sh`, usuário `thiago.n.morgado@gmail.com`; ainda NÃO gravada).
4. Q-062-2: conferir no Neon se há assinaturas reais `trialing` (SQL no RETOMAR seção 7); se a 065 for adiante, a política A vale.
5. Preços e limites dos planos (PLACEHOLDER), parecer jurídico da retenção, termos de uso e privacidade (continuam sem páginas).
6. `AUTH_URL` na Vercel: conferir que é exatamente `https://lead-forge-web-omega.vercel.app`.

1. **Testar a 068 no navegador** (bloco V) e a resposta do lead entrando; depois **068c/d** (anexos) e **068e**.
2. **SPEC-066b e 066c** (PIX no checkout; lista de mensalidades; card do Free), cada uma com QA; fechar a 066 atualizando os 3 docs.
3. **SPEC-067** (toasts): aprovar e executar depois da 066c.
4. **Teste ponta a ponta da 065 no navegador** (bloco T) para fechar a SPEC.
5. **Admin:** sino com eventos + sidebar (prompt acima).
6. **SPEC-063b:** cancelar/reativar/trocar plano no provedor (hoje cancelar no app NÃO cancela a recorrência do cartão no AbacatePay), HMAC do webhook, reconciliação e 2 achados médios do QA.
7. **Correção do seed/migrations em Preview** (risco D3): todo `git push` de branch gera deploy Preview que roda `prisma migrate deploy` e o seed no **mesmo banco da produção**.
8. **GitHub Actions "Tick (agendador)"** falha por trava de cobrança da conta GitHub (o agendador em produção não roda; você adiou). Pendências da auditoria: cabeçalhos de segurança, `npm audit` (Next com advisory crítico, correção em 16.4.0), landing prometendo o que só tem mock, limites de plano placeholder.

### Como religar o ambiente local de teste (o túnel e o monitor foram DESLIGADOS)
1. `colima start` (se `docker ps` falhar) e `docker compose up -d` (Postgres 5434, Redis 6379, Mailpit 8025/1025).
2. `npm run dev` e, em outro terminal, `npm run dev:tick` (podem ainda estar rodando; confira `lsof -nP -iTCP:3000 -sTCP:LISTEN`).
3. **Túnel:** `cloudflared tunnel --url http://localhost:3000` (já instalado). O endereço `*.trycloudflare.com` **muda a cada vez**: atualize `AUTH_URL` e `APP_BASE_URL` no `.env` com ele, reinicie o `npm run dev`, e **recadastre o webhook local** no AbacatePay (`<túnel>/api/billing/webhook?webhookSecret=<segredo>`; segredo local em `~/.leadforge-secrets/abacatepay_webhook_secret.txt`). `next.config.ts` está **modificado localmente** (`allowedDevOrigins: ["*.trycloudflare.com"]`): **não commitar**.
4. O `.env` local ficou com `PAYMENT_PROVIDER=abacatepay`, `ABACATEPAY_API_KEY` (dev, também em `~/abacatepay_dev_key.txt`), `ABACATEPAY_WEBHOOK_SECRET` e `AUTH_URL`/`APP_BASE_URL` apontando para o túnel antigo (morto). Para voltar ao normal: copie `~/.leadforge-secrets/env.backup-pre062` para `.env`. **Testes automatizados** devem rodar com `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test` no comando (senão 18 testes antigos falham por causa do `.env`), e sempre com `TEST_DATABASE_URL` de um banco `*_test` novo.
5. Para repetir o pagamento: `/signup` pelo endereço do túnel (não `localhost`), e-mail no Mailpit, `/assinar`, cartão de teste `4242 4242 4242 4242` (validade `12/30`, CVV `123`); recusa: final `0002`. O dev mode **não** tem API para simular pagamento de cartão: só na página hospedada.

### Cuidados (aprendidos nesta sessão)
- **Nunca `prisma migrate dev`.** Migrations só com `migrate deploy`; o banco de dev já tem as 45 (inclui `20261017120000` e `20261018120000`); o drift `20260928*` continua.
- **Segredos** ficam em `~/.leadforge-secrets/` (700) e na Vercel (não dá para ler de volta). A pasta de scratchpad da sessão em `/private/tmp` pode sumir. Perdeu um segredo de produção: rotacionar (apagar e recriar na Vercel e onde mais ele vive) e refazer o deploy. **Nunca colar chave/segredo no chat.** Chave do AbacatePay: criar em Integrar → API Keys (valor só aparece uma vez, começa com `abc_dev_`); o script `~/save_abacate_key.sh` grava em `~/abacatepay_dev_key.txt` sem eco.
- **Produção usa a chave de DEV do AbacatePay** (nada é cobrado de verdade). Trocar para a de produção só ao abrir ao público, com `ABACATEPAY_EXPECT_DEVMODE` revisado.
- A trava do mock está ativa: em produção, `PAYMENT_PROVIDER=mock` é recusado (a menos de `ALLOW_MOCK_BILLING=true`).
- Dev server: **não rode `next build`/`pkill next` com o app em uso**; derruba o `next dev`.
- O adaptador do AbacatePay v2 exige produto no catálogo + checkout com `items`; o `metadata` NÃO volta no webhook (a correlação é por IDs).
- Arquivos não rastreados que ficam de fora de commits: `.claude/`, `skills-lock.json` (Upstash), e a mudança local de `next.config.ts`.
- Vários agentes imprimiram a senha do Postgres **de desenvolvimento** (local) nos próprios logs; é só do seu Docker, mas rotacione se algum log for compartilhado.


## 1. Como conferir o estado em 1 minuto

```bash
git log --oneline -10 && git status --short   # árvore limpa = nada sobrando
npx tsc --noEmit                              # deve estar limpo
npx prisma migrate status                     # dev: "up to date" (confirmado em 2026-10-11); o drift 20260928* existe na tabela _prisma_migrations mesmo assim (seção 3b)
ls prisma/migrations                          # 44 entradas (43 migrations + migration_lock); a última é 20261016120000_search_run_cursor_060
```

Ambiente local: Postgres/Redis/Mailpit no Docker (`colima start` se `docker ps` falhar), `npm run dev` e **`npm run dev:tick`
em outro terminal** (sem ele criativos, sequências e a exclusão de conta não andam). Mailpit: http://localhost:8025.

## 2. Estado real

**SPECs 048 a 060 estão implementadas e todas na `main`.** Antes do PR #2: 048, 049 (a/b), 050, 051 (a/b), 052a, 052b (sem cartão), 057 e 058 (a/b).
Entraram com o PR #2, em ordem do mais antigo para o mais novo:

| Commit | O que entregou |
|---|---|
| `95e85e7` | SPEC-053: cancelamento e reativação da assinatura (e PRIMEIROS_PASSOS em linguagem simples) |
| `0d1e0d2` | SPEC-054: exclusão de conta com soft delete e purga em 30 dias |
| `e438d5f` | fix: achados do QA das SPECs 053 e 054 |
| `64a8d48` | SPEC-055: verificação de e-mail, boas-vindas e aviso de senha alterada |
| `4a46c05` | SPEC-056: e-mails aos owners sobre entrada, saída, remoção e mudança de papel |
| `6e4d12c` | docs: PRIMEIROS_PASSOS 2.7/2.8, ROTEIRO blocos J/K e RETOMAR (SPECs 053-056) |
| `09d7100` | **SPEC-036**: provedor LLM OpenAI-compatível (Groq/OpenRouter/Ollama/Gemini) por organização |
| `bc6a71b` | **SPEC-059**: rate limit persistente em Redis com fallback em memória |
| `7c7f99b` | **SPEC-060**: paginação da busca Places com cursor, fallback de variações e teto de orçamento |

(O PR #2 também trouxe `c3b571c`, `84bb762` e `85193b9`, mais um commit de docs/specs da PARTE 2.)

- **O que cada SPEC da PARTE 2 faz**
  - **036**: em `/configuracoes/integracoes`, o card "Provedor de LLM" aceita URL base opcional (com exemplos), chave opcional,
    caixa "instância própria" (custo zero só se o host é realmente de rede privada) e botão **Testar conexão**; o **Simular** dos
    agentes mostra provedor e modelo. Sem URL, segue o Claude como antes. Voltar de URL para Claude exige remover e recriar a
    integração. Sem migration e sem env nova.
  - **059**: todos os limiters usam Redis quando existe `REDIS_URL` (env opcional; o Redis já está no docker). Sem `REDIS_URL`, ou se
    o Redis cair, volta à memória do processo com aviso no log (`[rate-limit]`). Chaves hasheadas. `ioredis` instalado. Sem migration.
  - **060**: o botão da busca vira "Buscar mais resultados" (usa `nextPageToken`; quando acaba, passa para variações da busca). Cada
    clique faz 1 a 2 chamadas pagas e respeita o teto diário da 058. Migration `20261016120000`, já aplicada no dev.
- **Última verificação** (2026-10-11): `tsc` limpo, eslint 0 erros, vitest completo verde em banco `leadforge_*_test` novo. Depois dela
  rodou o E2E em navegador real (seção 6).
- **Migrations**: o banco de dev está com todas aplicadas, inclusive `20261015120000_email_verification` e
  `20261016120000_search_run_cursor_060` (aplicadas em 2026-10-11, via `migrate deploy`). Depois de qualquer `migrate deploy`, pare e ligue o
  `npm run dev`. Sobram só as 5 migrations `20260928*` que o repo não tem (drift, seção 3b).
- As SPECs 036 e 059 não têm migration.

## 3. Decisões que SÓ VOCÊ pode tomar

| # | Decisão | Bloqueia | Recomendação |
|---|---|---|---|
| 1 | ~~**Q-052-5** (cartão AbacatePay)~~ **RESOLVIDA pela SPEC-063a** (2026-10-12): a doc v2 tem `subscription.payment_failed` e `subscription.cancelled` (`cancelledDueTo=max_payment_retries_exceeded`); implementados | — | Falta validar com pagamento real (ROTEIRO E11/E12) |
| 2 | **Provedor de avatar real** (Q-051-1: HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar) | criativos reais (hoje só mock) | Escolher 1 e abrir SPEC; antes cumprir D-051-15 (SSRF/timeouts) |
| 3 | **Drift `20260928*`**: ver 3b | limpeza; "nunca `migrate dev`" vale até lá | Opção A |
| 4 | **Validação jurídica da retenção (D-054-4, INFERRED)**: 5 anos para registros de cobrança e 6 meses para logs; o código apaga logs após 6 meses, mas os registros de cobrança ficam sem prazo de descarte (não há job de 5 anos). A tela e o e-mail "conta excluída" também listam como retidos o usuário anonimizado, `AccountDeletionRequest`, reuniões e criativos (`src/lib/account-deletion/retention.ts`) | ir para produção com a 054 | Passar por um advogado |
| 5 | **Exportação de dados (LGPD art. 18 V, portabilidade)**: fora da 054 (D-054-6) | conformidade completa | SPEC-061 em DRAFT (`specs/61-exportacao-de-dados-lgpd/spec.md`; perguntas Q-061-n abertas) |
| 6 | **Revisar as decisões INFERRED das SPECs 055 e 056** (abaixo) | nada trava; são premissas | Aceitar ou pedir ajuste |

Resolvidas nesta rodada (não dependem mais de você): **Q-051-11** fechada (D-051-19: aceito o default, sem teto de retentativas dos
criativos; revisitar na SPEC do provedor real); **LLM grátis** (SPEC-036 implementada); **rate limit persistente** (SPEC-059
implementada); **paginação da busca Places** (SPEC-060 implementada).

Polimento pendente da 036 (não bloqueia): sugerir modelo default por provedor; mensagem de 429 sugerindo Ollama.

Decisões INFERRED revisáveis:
- D-055-1/7: nova conta self-service **nasce não verificada e não envia mensagens** (campanhas, sequências, envio manual) até confirmar o
  e-mail; login, checkout e demais telas seguem liberados.
- D-055-3: usuários existentes (e admin/seed) foram **marcados como verificados** na migration (`emailVerifiedAt` tem `DEFAULT now()`).
- D-055-4: sem tela de trocar senha ou e-mail logado; só o aviso "senha alterada" no reset. D-055-5: só pt-BR.
- D-055-6: convite conta como verificado só se o e-mail do cadastro for exatamente o convidado e o token for válido; código de entrada não.
- D-055-8: token de verificação expira em 24h, uso único, só hash; reenvio com cooldown de 60s e limites de 5/h por usuário e 20/h por IP.
- D-056-1: **só owners** recebem avisos de organização (o membro afetado não recebe e-mail).
- D-056-2: e-mail imediato por evento, com **teto de 10 entradas por hora por organização** (excedentes ficam só na auditoria).
- D-056-3: 4 eventos (entrou, saiu, removido, papel alterado); quem fez a ação não é notificado.

### 3b. Drift das migrations `20260928*` (decisão sua; só foi investigado, nada foi alterado)

**O que é.** 5 migrations aplicadas só no banco de dev, vindas de outro clone, que **nunca existiram no git de nenhuma branch**:
`20260928000000_add_abacatepay_product_id`, `20260928000001_add_user_document`, `20260928000002_add_org_document`,
`20260928000003_add_org_flags` e `20260928120000_access_blocked_kind`.

**O que elas criaram no banco.**
- `Plan.abacatepayProductId`.
- `User.document` e `User.documentType`, com `UNIQUE (document, documentType)` e o índice `User_document_idx`.
- `Organization.document`, `documentType`, `documentBlocked` e `trialBlocked` (os dois booleanos `NOT NULL DEFAULT false`).
- o valor `access_blocked` no enum `BillingReminderKind`.

Nada em `schema.prisma`, `src/` ou `specs/` usa isso.

**Dados no dev.** 2 de 9 users e 2 de 11 orgs têm CPF de teste; 0 planos com `productId`; 0 flags `true`; 0 linhas com `access_blocked`.

**Como o Prisma enxerga.** `npx prisma migrate status` (rodado em 2026-10-11) diz "up to date" **mesmo com o drift**: as 5 migrations `20260928*` estão em
`_prisma_migrations` (conferido por SQL) e não existem no repo. Todas as migrations do repo estão aplicadas. Em um banco sem o drift (clone limpo),
o comando não lista as 5.

**Risco.** Em runtime é nulo (colunas nullable ou com default). O risco real: `prisma migrate dev` pode propor **reset ou drop** dessas
colunas e dados.

**Opção A (recomendada): limpar só o banco de dev.**
1. `pg_dump -Fc` do banco de dev (backup).
2. Em uma transação: dropar os 2 índices (`User_document_idx` e o UNIQUE `(document, documentType)`) e as 7 colunas
   (`Plan.abacatepayProductId`, `User.document`, `User.documentType`, `Organization.document`, `documentType`, `documentBlocked`,
   `trialBlocked`); depois `DELETE FROM _prisma_migrations WHERE migration_name LIKE '20260928%'`.
3. Deixar o valor `access_blocked` no enum (Postgres não remove valor de enum sem recriar o tipo; é inofensivo).
- Riscos: perde 4 CPFs de teste (o backup cobre); se o outro clone reaplicar as migrations, o drift reaparece.

**Opção B: trazer para o repositório.** Exige o SQL original (o `checksum` em `_prisma_migrations` diverge se for reescrito),
importa uma feature sem SPEC e expande dados pessoais (LGPD/SPEC-054). Só faz sentido se surgir uma SPEC de CPF/CNPJ.

## 4. O que só funciona com você (chaves, contas, navegador)

- **Validar à mão** o que ficou `[ ]` nos blocos D, E, F, G, H a O do `docs/ROTEIRO_DE_TESTES.md` (o que o Claude já passou está `[x]` com
  "Claude, navegador automatizado"). Falta também o seu olhar em dark mode das páginas públicas, teclado e leitor de tela.
- **LLM grátis (036)**: validar de verdade com **Ollama** (local) e **Gemini** (chave do AI Studio); só foi testado com mocks.
- **Redis (059)**: para ligar, `REDIS_URL=redis://localhost:6379` no `.env` e reiniciar; conferir o aviso `[rate-limit]` ao parar o Redis.
- **Google Places / Maps**: criar chave (Fase 8 do PRIMEIROS_PASSOS), `LEAD_SEARCH_ENABLED=true`, cadastrar em
  `/configuracoes/integracoes`. A busca (inclusive a paginação da 060) nunca rodou com a API real; o SKU cobrado não foi confirmado;
  defina teto de orçamento no Google.
- **Azure (ACS e Blob), Resend, AbacatePay, Evolution, Claude**: só testados com mocks. Valide o recibo com webhook real/sandbox do
  AbacatePay (campos `amount`, `paidAt`, `card.lastDigits` foram assumidos).
- **Produção (Vercel)**: definir `CRON_SECRET` (o `vercel.json` tem cron diário por causa do plano Hobby; o tick a cada 5 min é o workflow `.github/workflows/tick.yml`, que precisa dos segredos `CRON_SECRET` e `APP_URL` no GitHub) e
  `TRUSTED_PROXY_IP_HEADER` (obrigatória em produção), além de envs de e-mail e storage; e `REDIS_URL` se houver mais de uma
  instância (senão o rate limit não é compartilhado). Sem `CRON_SECRET` nada avança (sequências, criativos, busca, purga de conta).

## 4b. Fora do escopo: app móvel

Decisão do usuário (2026-10-11): **o projeto é só web**. As SPECs 021, 022 e 023 (API `/api/mobile/v1`: login, métricas e alertas/push) já
estão implementadas e testadas (`src/lib/mobile/`), mas ficam **fora do escopo atual**: sem manutenção e sem validação em aparelho. O app
móvel mora em outro repositório (`../mobile`, que não existe neste ambiente). As SPECs 024 a 026 nunca existiram aqui. Nenhuma SPEC nova
depende da API móvel. O item I5 do ROTEIRO (app móvel) não é mais pendência. Remover o código é uma decisão futura, não feita.

## 5. Riscos conhecidos atuais (não bloqueiam, mas não esqueça)

- Sem `REDIS_URL` (ou com o Redis fora do ar) os limiters caem para **memória por processo**: zeram ao reiniciar e não valem entre
  instâncias; o aviso aparece no log.
- E-mail se **perde** se o provedor falhar depois da reserva da chave de idempotência (sem retry), nos e-mails de 052a/052b, 055 e 056.
- O signup espera o envio de SMTP (trial, boas-vindas, confirmação). Isso cria diferença de tempo na resposta entre e-mail novo e
  e-mail já existente, o que permite **enumeração de contas** por medição de tempo (limitada pelo rate limit).
- Reativação feita **fora do app** (direto no Stripe real) será ignorada quando o adapter Stripe existir (053-1).
- Cartão do AbacatePay pode continuar cobrando até alguém cancelar no painel do provedor (não há endpoint, D-053-5).
- A purga não tem job de 5 anos para registros de cobrança (ver decisão 4); `EmailDispatchLog` sem purga.
- Termos da Places API restringem cache/armazenamento de dados: confirme antes de operar em escala. A paginação da 060 faz até 2
  chamadas pagas por clique, sempre dentro do teto da 058.
- Em LLM com URL própria, "instância própria" só dá custo zero se o host é de rede privada de verdade; marcar errado distorce o orçamento.
- `.storage/` (arquivos locais) e `.env` não vão para o git (conferido).

## 6. Achados do E2E em navegador real ainda abertos (dependem de você) e contas de teste

- **Remover membro com sessão aberta**: o removido vai para `/login` (perde a sessão), não para a organização própria. Funciona e é seguro
  (trocar a org na sessão exigiria escrever cookie dentro de `requireUser`); decida se vale ajustar.
- **URL do vídeo é assinada e pública até expirar** (qualquer pessoa com o link baixa, como a SAS do Azure; desenho da SPEC-050): garanta
  expiração curta em produção.
- **Remetente dos e-mails** em dev sai de `seu-email@gmail.com` (placeholder do `.env`): configure `ACS_FROM_*`/`RESEND_FROM_*`/`SMTP_FROM` reais.
- **Mailpit poluído** pelos testes automatizados (centenas de `zz-*@test.local`): pesquise pelo destinatário.
- **Formulário de nova campanha** não foi exercitado na interface: teste à mão.
- **Cadastro com e-mail que já existe** (J11): nenhum e-mail sai para o existente, mas a resposta **não é igual** à de um e-mail novo (novo
  vai ao `/dashboard`; existente fica em `/signup` com "Não foi possível concluir o cadastro..."): dá para descobrir que o e-mail existe.
  Decida se aceita (é o comportamento desde a SPEC-049) ou se vira resposta idêntica (exigiria fluxo "confirme pelo e-mail" para todos).

**E2E em navegador real, 2026-10-11 (Claude, Brave + Playwright)** nas telas das SPECs 053 a 060. Passou e está marcado `[x]` no ROTEIRO:
H1-H7, I3-I9, I11-I12 (parcial), J1-J4, J8-J10, J14, J16 (parcial), K1, K3-K5, K10-K11, L1, L3, L4, L6, L8, M2, M3, M5, N1 (só a interface), N8.
Bugs achados e corrigidos: (1) rate limit em Redis: a 1ª chamada depois de subir o app ignorava o Redis (conexão ainda abrindo) e o
bloqueio salvo não valia logo após reiniciar; (2) "Aprovar em lote" sem e-mail verificado só dizia "bloqueado"; (3) o botão "Testar
conexão" aparecia para o Claude sem URL; (4) o roteiro dizia que o botão de cancelar fica desabilitado (na verdade valida e mostra erro).
**Não testado** (precisa de chave/serviço real ou de preparo que não fiz): chamadas reais ao Google Places (N2-N7), Ollama/Gemini/Groq reais
(L2, L5, L9), SMTP caído (J15, K9), convite com mesmo e-mail (J13), aprovar/enviar sem verificar (J5-J7, só testes automáticos), K2, K6-K8,
H8-H12, I10, M1/M4/M6, dark mode e teclado das páginas públicas, leitor de tela.
**Atenção local:** se você tem um Redis instalado no Mac (Homebrew), ele pode ocupar `localhost:6379` no lugar do container
`leadforge-redis-1`; confira com `lsof -nP -iTCP:6379 -sTCP:LISTEN`.

Contas de teste no banco de dev: `claude.a*@testes-claude.local` (senha de teste `SenhaForte-12345`, **só dev**). Dados de teste: orgs
"Empresa A ...", "Segunda Org Teste", criativos e o lead "Lead Secreto do Tenant A". Podem ser apagados.

## 7. Próximo trabalho (plano para continuar)

**SPEC-065 (teste gratis de 7 dias com limites; org criada no cadastro; bloqueio total ao expirar) — `specs/65-free-trial-7-dias-limites/spec.md`, DRAFT (aguardando `APROVAR SPEC-065`), so documentacao, nada codificado (2026-10-12).** Decisao do usuario (D-065-1..5): cadastro cria usuario+organizacao no plano Free (trial de 7 dias, limites baixos PLACEHOLDER), cai direto no dashboard; a tela de pagamento so aparece no upgrade ou ao expirar; expirou sem assinar = bloqueio total (so assinatura e Minha conta; dados guardados). **REVERTE a 062** (D-062-1/2/3/5/7/16/17 e a emenda D-062-25): cancela a 062c e a 062d (dashboard sem organizacao); a casca de cobranca fica so para 2a organizacao paga e usuario sem organizacao; o checkout vira upgrade da organizacao existente (adaptador/webhook da 063 sem mudar). Exige **aplicar os limites no codigo** (hoje nada aplica `maxCampaigns/maxWhatsappInstances/maxLeadsPerMonth`): contador atomico `UsageCounter`, `TrialClaim` anti-abuso, `requireProviderOrg` fail-closed. Divisao 065a (backend) / 065b (frontend); **comecar so depois da 064 ser commitada** (mesma superficie de `signUp`). **Depende de voce (bloqueantes):** Q-065-1 cartao no cadastro (rec.: nao), Q-065-2 pagar durante o trial (rec.: cobrar na hora), Q-065-4 por quanto tempo guardar dados de quem nao assinou (rec.: 90 dias), Q-065-9 cancelar a 062d (rec.: sim); valores finais dos limites do Free (Q-065-3) e quando o AbacatePay real fica pronto (Q-065-14).

**SPEC-064 (senha do cadastro: mínimo 6, confirmar senha, barra de força) — `specs/64-senha-cadastro/spec.md`, IMPLEMENTED em 2026-10-12, branch `feat/spec-064-senha-cadastro`, SEM commit, aguarda QA em navegador (bloco S do ROTEIRO).** Política de senha mudou de 12 para 6 por decisão do usuário. Regra única em `src/lib/schemas/password.ts`; `scorePassword` em `src/lib/password-strength.ts`; componente `PasswordStrength`. `confirmPassword` validado no cliente e no servidor (signUp, signUpAndJoin, resetPassword). `next.config.ts` tem mudança local que NÃO é desta SPEC (não commitar junto).

**Onde estamos (2026-10-11):** `main` com as SPECs 048 a 060 e a 045 (react-hook-form; QA APPROVED, `next build` ok, vitest 2055 verde),
E2E em navegador real e Fase 9. **Produção no ar na Vercel** (`https://lead-forge-web-omega.vercel.app`, sem domínio próprio): `/` e
`/login` respondem 200; no build, "43 migrations found, no pending" e seed em modo produção (só planos e admin). Falta o bloco O do
ROTEIRO à mão (desktop e 390px). Não há SPEC em implementação; a 062 (a+b) espera QA e a 061 está em DRAFT.

**SPEC-063 (adaptador AbacatePay v2, corrige o 422) — `specs/63-abacatepay-v2-adaptador/spec.md`, APPROVED em 2026-10-12.**
- **063a IMPLEMENTADA em 2026-10-12, branch `feat/spec-063a-abacatepay-v2` (a partir de `feat/spec-062b-frontend`), SEM commit** (ver "Implementation Notes — 063a" na SPEC, com os formatos REAIS da API): catálogo de produtos (`BillingProduct`, lock + cache), corpo real de `subscriptions/create` + `Subscription.externalCheckoutId`, webhook v2 (parser + correlação `subs_`/`bill_`/`lf:`/API, `payment_failed`/`cancelled`/`renewed`/`completed`/`transparent.completed`), PIX com corpo real, log 4xx sem segredos, mensagens "pagamento indisponível". **Fecha Q-052-5** (cartão tem `subscription.payment_failed`).
- **Para você aplicar:** a migration `20261018120000_abacatepay_v2_catalogo` (aditiva, só aplicada em bancos `*_test`): `npx prisma migrate deploy` no dev (nunca `migrate dev`), depois reiniciar o `npm run dev`. A coluna órfã `Plan.abacatepayProductId` do drift (3b) **não é usada**.
- **Para você testar o pagamento:** PRIMEIROS_PASSOS 9.7 e ROTEIRO E12 (chave de dev, webhook HTTPS via túnel com os 5 eventos, cartão `4242 4242 4242 4242`). O webhook de dev precisa ser cadastrado por você (não foi criado nenhum).
- **063b PENDENTE** (decidida separada): `subscriptions/cancel` no cancelar do app (hoje cancelar no app NÃO cancela o cartão no AbacatePay), reativar = reassinar + empilhar período (Q-063-1), `changePlan`, reaproveitar checkout pendente, reconciliação em `/assinar/retorno` (Q-063-5), HMAC `X-Webhook-Signature` (Q-063-7), E2E com pagamento. Atenção: "não encontrado" do AbacatePay é HTTP **400** `"Subscription not found"` (não 404).
- Achados que mudam premissas da SPEC: produto duplicado por corrida no provedor (resolvido com lock), `YEARLY` = 422 (`ANNUALLY` ok), `description` do PIX só ASCII, mesmo `externalId` devolve a mesma cobrança/checkout, `methods:["PIX"]` em assinatura = indisponível nesta loja (Q-063-14).
- Observação dos testes: o `.env` local tem `PAYMENT_PROVIDER=abacatepay`, `ABACATEPAY_*` e `APP_BASE_URL` (túnel); a suíte só fica verde com `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test` no ambiente do comando (os testes pré-existentes assumem isso; não é regressão da 063a).

**SPEC-062 (cadastro so com usuario, sem trial, plano obrigatorio) — `specs/62-cadastro-sem-trial-plano-obrigatorio/spec.md`, APPROVED em 2026-10-11.**
- **062a (backend) IMPLEMENTADA em 2026-10-11, na branch `feat/spec-062a-backend` (commit `dd2ce4e`)** (ver "Implementation Notes — 062a" na SPEC): migration `20261017120000_cadastro_sem_trial` (aditiva, **ainda nao aplicada no dev/producao**: rode `prisma migrate deploy` so quando decidir), casca de cobranca (`Organization.setupPendingSince`), guard `requireProviderUser`, actions `signUp`/`startPlanCheckout`/`getPlanCheckoutState`/`cancelPendingSubscription`/`completeOrganizationSetup`/`getAccountStage`, convite/codigo sem checkout, trial removido do codigo, jobs de limpeza (7 dias) e lembretes D+1/3/7, trava do `mock` em producao (`ALLOW_MOCK_BILLING`), relatorio de trials legados (`npm run billing:trials-report`, somente leitura). Gates: tsc, eslint (0 erros), vitest completo (170 arquivos, 2171 testes, banco `leadforge_062a_test` novo) e `next build` verdes.
- **062b (frontend) IMPLEMENTADA em 2026-10-11, na branch `feat/spec-062b-frontend`, SEM commit** (ver "Implementation Notes — 062b" na SPEC): `/signup` (3 campos), `/assinar`, `/assinar/retorno` (polling), `/organizacao/nova`, `/entrar-em-organizacao`, `/minha-conta` (grupo `src/app/(onboarding)/`, guarda `src/lib/auth/stage-guard.ts`), banner "Finalize sua organizacao", "Em configuracao" no admin, link `/assinar?nova=1` no lugar do `CreateOrganizationDialog`, landing/pricing sem "gratis/14 dias/sem cartao", docs (PRIMEIROS_PASSOS 2.2, ROTEIRO bloco P). Gates: tsc, eslint (0 erros), vitest completo (173 arquivos, 2254 testes, banco `leadforge_062b_test` novo), `next build` e fluxo no Brave (mock, banco de teste) verdes. **Proximo passo: QA independente e depois commit/push da 062b.** Falta ver em navegador: link de e-mail real, timeout do polling, cancelar da casca, codigo/convite validos.
- **EMENDA D-062-25 (decidida pelo usuario em 2026-10-12; SPEC segue APPROVED, "emendada pelo usuario em 2026-10-12 (D-062-25); implementacao do ajuste pendente de revisao da emenda"; NADA codificado):** depois do cadastro, usuario **sem plano e sem organizacao NAO vai mais para `/assinar`**: ele **entra no `/dashboard`** (estado vazio "Voce ainda nao tem uma organizacao" com "Assinar um plano e criar minha organizacao" -> checkout so cartao, "Entrar com convite ou codigo" sem pagar, e Minha conta). So **criar organizacao** exige plano; ninguem e obrigado a assinar para entrar. **Vale mudar na 062a/062b ja feitas (nao commitadas/QA'd a 062b):** `resolveStageRoute` (`sem_plano`/`aguardando_pagamento` -> `/dashboard`), `resolveSessionHomeRoute` (hoje devolve `null` p/ `/dashboard` sem `orgId` = **laco**; corrigir), `(app)/layout.tsx` (hoje redireciona sem org = **ciclo**; passa a shell reduzido), `(app)/dashboard/page.tsx` (ramo sem org), `requirePageProviderOrg` (redirect p/ `/dashboard`), `signUp.redirectTo`, e-mail de boas-vindas, telas/links/copy, `PRIMEIROS_PASSOS` 2.2/2.3, `ROTEIRO` B1/B2/B8/C1/C8/P/0.4, `TESTES_PRIORITARIOS` 5. `requireProviderOrg`/`requireActiveProviderOrg` e as ~47 telas por organizacao **nao mudam**. **Recomendacao:** QA+commit da 062b como esta; depois 062d como entrega unica fullstack (alternativa 062d backend + 062e frontend na mesma PR). Perguntas novas **Q-062-10..15** (pago-sem-org, intencao de plano da landing, o que o dashboard vazio mostra/oculta, aviso de e-mail, convites pendentes, barreira por pagina x grupo de rotas) — detalhes na SPEC, secao "Emenda D-062-25". **Proximo passo:** o usuario revisar a emenda e responder Q-062-10..15; depois aprovar e implementar 062d.
- **Antes de publicar:** (1) Q-062-2 segue aberta: rode `npm run billing:trials-report` no Neon de producao (a regra nova suspende trial vencido/sem data; antes trial nunca expirava); (2) producao esta em `mock`: com a trava o checkout fica indisponivel ate haver AbacatePay real (ou `ALLOW_MOCK_BILLING=true`); (3) **achado:** `src/proxy.ts` nao isenta `/api/billing/webhook` no `matcher` (so `api/webhooks`, `api/cron`, `api/integrations`, `api/mobile/v1`), entao o webhook do provedor sem sessao tende a levar 307 para `/login`: confirmar com webhook real e decidir a isencao (a SPEC-062 mandou nao mexer na lista do proxy).

**Etapa 1: destravar o deploy (FEITA em 2026-10-11, com 3 pendências suas)**
- Vercel (Production) com: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`, `AUTH_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`,
  `TRUSTED_PROXY_IP_HEADER=x-real-ip`, `APP_BASE_URL`, `REDIS_URL`. GitHub Actions com `CRON_SECRET` e `APP_URL`.
- **Redis:** criado pelo Marketplace (Upstash for Redis, resource `leadforge-redis`, Production e Preview). Veio `REDIS_URL` (o app usa
  esta) e `KV_*` (não usadas). Ainda não validei o bloqueio de login sobrevivendo a deploy.
- **`CRON_SECRET` foi rotacionado** (novo valor na Vercel e no GitHub; deploy refeito; `POST /api/cron/tick` com o segredo novo = 200).
  Cópia local temporária do valor na pasta de scratchpad da sessão: apague depois de configurar o agendador.
- **Pendente 1, `AUTH_URL`:** não consegui ler o valor. Confira na Vercel que é exatamente `https://lead-forge-web-omega.vercel.app`
  (sem barra no fim).
- **Pendente 2, agendador:** o workflow `Tick (agendador)` do GitHub **não roda**: "your account is locked due to a billing issue".
  Opção A: resolver o billing do GitHub e rodar o workflow (esperado `HTTP 200`). Opção B (preparada): cron-job.org, a cada 5 min,
  `POST https://lead-forge-web-omega.vercel.app/api/cron/tick`, header `Authorization: Bearer <CRON_SECRET>`; Test run deve dar 200.
  Sem nenhum dos dois só o cron diário da Vercel roda (sequências, criativos, busca e purga ficam lentos). Com os dois ativos, desligue
  um: não verifiquei se o tick é seguro em duplicidade.
- **Pendente 3:** a instalação do Upstash criou `.agents/`, `.claude/` e `skills-lock.json` sem commit (e o deploy os incluiu). Decida se
  entram no git ou no `.gitignore`.

**Etapa 2: produção no ar (em andamento)**
1. ~~Postgres (Neon) e Redis (Upstash) na nuvem.~~ Feito. 2. **E-mail real com domínio verificado (9.5):** falta; confira se `SMTP_*`
na Vercel não são o placeholder de dev. 3. **Arquivos:** `STORAGE_PROVIDER=azure` + Azure Blob (9.6); sem isso `/criativos` dá 503.
4. **Cobrança (AbacatePay, dev mode):** conferido em 2026-10-11: **não há** `PAYMENT_PROVIDER` nem `ABACATEPAY_*` na Vercel, então o
checkout segue em **mock**. Falta: cadastrar o webhook no painel (`https://lead-forge-web-omega.vercel.app/api/billing/webhook`) com o
segredo, gravar `PAYMENT_PROVIDER=abacatepay`, `ABACATEPAY_API_KEY` (chave de dev) e `ABACATEPAY_WEBHOOK_SECRET` na Vercel e redeploy
(9.7). O segredo do webhook foi gerado em arquivo local (scratchpad da sessão; apague depois de usar). O PR #10 corrige o
`envSchema`, que rejeitava `abacatepay` (bug latente, nada o chamava). Ainda não validado com o AbacatePay real: recibo
(`amount`, `paidAt`, `card.lastDigits`) e falha de cartão (Q-052-5).
5. Opcionais: Google Places (`LEAD_SEARCH_ENABLED=true`, 9.9) e chave de LLM no painel. 6. Roteiro de 12 itens (9.10).
O WhatsApp (Evolution) e o avatar real continuam de fora.

**Etapa 3: os 10 testes de maior risco (`docs/TESTES_PRIORITARIOS.md`)**
- Sem chaves reais, comece pelos testes 5 a 10 (cadastro limpo, suspender org, e-mail não confirmado, cancelamento, isolamento, teclado/escuro).
- Com chaves reais: testes 1 a 4 (AbacatePay, e-mail real, Places, LLM real).
- Anote o que falhar na coluna "Observado" do ROTEIRO e mande ao Claude: correção com teste de regressão.

**Etapa 4: decisões suas (~5 min cada)**
| Decisão | Recomendação |
|---|---|
| Drift das migrations `20260928*` (seção 3b) | Opção A: `pg_dump` e remover só do dev |
| J11: cadastro com e-mail já existente revela que ele existe | Resposta igual nos dois casos |
| Parecer jurídico da retenção (5 anos e 6 meses, D-054-4) | Validar antes de abrir ao público |
| Preços dos planos (PLACEHOLDER, D-33-2) | Definir antes do primeiro cliente |
| Provedor de avatar real | Escolher 1 (HeyGen, D-ID, Tavus...) |

**Etapa 5: código (só depois das etapas 3 e 4)**
1. Correções do que o teste manual achar (prioridade máxima).
2. SPEC do avatar real, cumprindo D-051-15 (SSRF e timeouts), após a escolha do provedor.
3. Cartão do AbacatePay (Q-052-5): mapear `subscription.cancelled` quando houver sandbox.
4. Futuro: exportação de dados LGPD, termos de uso e política de privacidade (conteúdo jurídico), plano Pro da Vercel com cron por minuto.

**Sugestão para a próxima sessão:** fechar os pendentes da Etapa 1 e o resto da Etapa 2, testes 5 a 10, e trazer ao Claude o que falhar mais as 5 decisões.

Regra combinada: **só commitar quando tudo estiver verde** (tsc, lint sem erros, vitest em banco `*_test` novo, QA aprovado); nunca
rodar `migrate dev` neste banco.

## 8. Produção (Fase 9 do PRIMEIROS_PASSOS)

- Passo a passo para colocar no ar: `docs/PRIMEIROS_PASSOS.md`, Fase 9 (banco, Redis, segredos, domínio, e-mail, Azure Blob, AbacatePay, tick, roteiro de conferência de 12 itens).
- **Achado corrigido:** o `buildCommand` da Vercel roda `prisma db seed` a cada deploy, e o seed criava organização e 20 leads de demonstração em produção. Agora, com `VERCEL_ENV=production` ou `NODE_ENV=production`, o seed cria só planos e o admin (`isProductionEnv` em `prisma/seed.ts`, com teste).
- **Atenção:** a cada deploy o seed **repõe a senha** do admin para `ADMIN_PASSWORD`. Preços dos planos são PLACEHOLDER (D-33-2): confirme antes de abrir ao público.
