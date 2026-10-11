# Para retomar: o que está pronto, o que depende de você e o que vem depois

Atualizado em 2026-10-10. Branch de trabalho: `docs/retomar-merge-feito` (a `main` já tem as SPECs 048-052b, 057 e 058; as SPECs
053-056 estão só nesta branch, commitadas, **ainda sem PR**). Repo: git@github.com:morgadothiago/LeadForge_web.git.

## 1. Como conferir o estado em 1 minuto

```bash
git log --oneline -10 && git status --short   # árvore limpa = nada sobrando
git log main..HEAD --oneline                  # o que esta branch tem a mais que a main
npx tsc --noEmit                              # deve estar limpo
npx prisma migrate status                     # dev: 1 migration pendente + 5 "não encontradas localmente" (drift, ver seção 3)
ls prisma/migrations                          # 42 migrations; a última é 20261015120000_email_verification
```

Ambiente local: Postgres/Redis/Mailpit no Docker (`colima start` se `docker ps` falhar), `npm run dev` e **`npm run dev:tick`
em outro terminal** (sem ele criativos, sequências e a exclusão de conta não andam). Mailpit: http://localhost:8025.

## 2. Estado real

**SPECs 048 a 058 estão implementadas.** Na `main`: 048, 049 (a/b), 050, 051 (a/b), 052a, 052b (sem cartão), 057 e 058 (a/b).
Nesta branch (`git log main..HEAD` mostra 9 commits à frente da `main`), as SPECs 053-056, em ordem do mais antigo para o mais novo:

| Commit | O que entregou |
|---|---|
| `95e85e7` | SPEC-053: cancelamento e reativação da assinatura (e PRIMEIROS_PASSOS em linguagem simples) |
| `0d1e0d2` | SPEC-054: exclusão de conta com soft delete e purga em 30 dias |
| `e438d5f` | fix: achados do QA das SPECs 053 e 054 (evento externo não desfaz agendamento, regra única agendado x imediato, bloqueio de org sem assinatura, lista de retidos completa) |
| `64a8d48` | SPEC-055: verificação de e-mail, boas-vindas e aviso de senha alterada |
| `4a46c05` | SPEC-056: e-mails aos owners sobre entrada, saída, remoção e mudança de papel |

(A branch também carrega `c3b571c`, `84bb762` e `85193b9`: correção do wizard de criativos, docs do E2E e último aviso em D+6.)

- **Última verificação** (na SPEC-056, banco novo `leadforge_056_test`): `tsc` limpo, eslint 0 erros (20 warnings antigos), vitest
  **159 arquivos / 2004 testes** verdes. A árvore está limpa. Nada disso foi validado em navegador real (só SSR e testes).
- **Migrations aditivas no banco de dev** (conferido com `npx prisma migrate status`):
  - `20261014120000_account_deletion_request` (SPEC-054): **já aplicada** (a última em comum entre o projeto e o banco).
  - `20261015120000_email_verification` (SPEC-055): **FALTA aplicar.** Rode `npx prisma migrate deploy` (**nunca `migrate dev`**) e
    depois pare e ligue o `npm run dev` de novo (o Prisma Client antigo falha em silêncio).
- A 056 não tem migration.

## 3. Decisões que SÓ VOCÊ pode tomar

| # | Decisão | Bloqueia | Recomendação |
|---|---|---|---|
| 1 | **Q-052-5**: nomes dos eventos de falha/recuperação de cartão do AbacatePay (precisa da doc/sandbox do provedor) | régua de cartão da 052b (hoje só dispara por estado/grace via job) | Pesquisar na doc do provedor |
| 2 | **Provedor de avatar real** (Q-051-1: HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar) | criativos reais (hoje só mock) | Escolher 1 e abrir SPEC; antes cumprir D-051-15 (SSRF/timeouts) |
| 3 | **Q-051-11**: teto de retentativas dos criativos | ajuste fino | Aceitar o default |
| 4 | **Drift `20260928*`** (CPF/CNPJ, trial, AbacatePay): o banco de dev tem 5 migrations que o projeto não tem (`add_abacatepay_product_id`, `add_user_document`, `access_blocked_kind`, `add_org_document`, `add_org_flags`) | limpeza; o aviso "nunca `migrate dev`" vale até lá | Decidir se a feature existe; se não, remover só no banco de dev, com backup |
| 5 | **Rate limit persistente** (D-049-14): hoje em memória, não vale entre instâncias | produção multi-instância | SPEC própria (Redis/Postgres) antes de escalar |
| 6 | **LLM grátis**: SPEC-036 aprovada e **não implementada** (adapter OpenAI-compatível: Groq/OpenRouter/Ollama/Gemini) | agentes de IA sem custo | Implementar a 036 |
| 7 | **Paginação da busca Places** (`nextPageToken`/rotação de keywords): hoje 1 página de até 20 e repetir dá duplicados | qualidade da captação | SPEC separada |
| 8 | **Validação jurídica da retenção (D-054-4, INFERRED)**: 5 anos para registros de cobrança e 6 meses para logs de auditoria; o código apaga os logs após 6 meses, mas os registros de cobrança ficam sem prazo de descarte (não há job de 5 anos). A tela e o e-mail "conta excluída" também listam como retidos o usuário anonimizado, `AccountDeletionRequest`, reuniões e criativos (`src/lib/account-deletion/retention.ts`) | ir para produção com a 054 | Passar por um advogado |
| 9 | **Exportação de dados (LGPD art. 18 V, portabilidade)**: fora da 054 (D-054-6) | conformidade completa | SPEC futura |
| 10 | **Revisar as decisões INFERRED das SPECs 055 e 056** (veja abaixo) | nada trava; são premissas | Aceitar ou pedir ajuste |

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

## 4. O que só funciona com você (chaves, contas, navegador)

- **Validar no navegador real** os blocos novos J (SPEC-055) e K (SPEC-056), mais os itens novos de H e I, e os blocos D, E, F e G do
  `docs/ROTEIRO_DE_TESTES.md`. Falta também o seu olhar em dark mode e teclado/leitor de tela. Nenhum item novo foi marcado como passou.
- **Google Places / Maps**: criar chave (Fase 8 do PRIMEIROS_PASSOS), `LEAD_SEARCH_ENABLED=true`, cadastrar em
  `/configuracoes/integracoes`. A busca nunca rodou com a API real; o SKU cobrado não foi confirmado; defina teto de orçamento no Google.
- **Azure (ACS e Blob), Resend, AbacatePay, Evolution, Claude**: só testados com mocks. Valide o recibo com webhook real/sandbox do
  AbacatePay (campos `amount`, `paidAt`, `card.lastDigits` foram assumidos).
- **Produção (Vercel)**: definir `CRON_SECRET` (cron por minuto já está no `vercel.json`; exige plano pago, no Hobby só 1x/dia) e
  `TRUSTED_PROXY_IP_HEADER` (obrigatória em produção), além de envs de e-mail e storage. Sem `CRON_SECRET` nada avança (sequências,
  criativos, busca, purga de conta).

## 5. Riscos conhecidos atuais (não bloqueiam, mas não esqueça)

- Todos os limiters (reenvio de verificação, cancelamento, etc.) são **em memória por processo**: zeram ao reiniciar e não valem entre instâncias.
- E-mail se **perde** se o provedor falhar depois da reserva da chave de idempotência (sem retry), nos e-mails de 052a/052b, 055 e 056.
- O signup espera o envio de SMTP (trial, boas-vindas, confirmação). Isso cria diferença de tempo na resposta entre e-mail novo e
  e-mail já existente, o que permite **enumeração de contas** por medição de tempo (limitada pelo rate limit).
- `bulkApproveFollowups` mostra só "blocked" quando o motivo é `email_not_verified` (não diz que é o e-mail).
- Reativação feita **fora do app** (direto no Stripe real) será ignorada quando o adapter Stripe existir (o evento externo não desfaz
  mais cancelamento agendado, 053-1).
- Cartão do AbacatePay pode continuar cobrando até alguém cancelar no painel do provedor (não há endpoint, D-053-5).
- A purga não tem job de 5 anos para registros de cobrança (ver decisão 8); `EmailDispatchLog` sem purga.
- Termos da Places API restringem cache/armazenamento de dados: confirme antes de operar em escala.
- `.storage/` (arquivos locais) e `.env` não vão para o git (conferido).

## 6. Achados do E2E em navegador real ainda abertos (dependem de você) e contas de teste

- **Remover membro com sessão aberta**: o removido vai para `/login` (perde a sessão), não para a organização própria. Funciona e é seguro
  (trocar a org na sessão exigiria escrever cookie dentro de `requireUser`); decida se vale ajustar.
- **URL do vídeo é assinada e pública até expirar** (qualquer pessoa com o link baixa, como a SAS do Azure; desenho da SPEC-050): garanta
  expiração curta em produção.
- **Remetente dos e-mails** em dev sai de `seu-email@gmail.com` (placeholder do `.env`): configure `ACS_FROM_*`/`RESEND_FROM_*`/`SMTP_FROM` reais.
- **Mailpit poluído** pelos testes automatizados (centenas de `zz-*@test.local`): pesquise pelo destinatário.
- **Formulário de nova campanha** não foi exercitado na interface: teste à mão.

Contas de teste no banco de dev: `claude.a*@testes-claude.local` (senha de teste `SenhaForte-12345`, **só dev**). Dados de teste: orgs
"Empresa A ...", "Segunda Org Teste", criativos e o lead "Lead Secreto do Tenant A". Podem ser apagados.

## 7. Próximo trabalho

1. Aplicar a migration `20261015120000_email_verification` no dev, reiniciar o `npm run dev` e validar os blocos J e K no navegador.
2. Abrir o PR da branch `docs/retomar-merge-feito` para a `main` (SPECs 053-056); o merge é seu.
3. **PARTE 2** (depende das decisões da seção 3): SPEC-036 LLM grátis; rate limit persistente; paginação da busca Places; Q-052-5
   (eventos de cartão do AbacatePay); Q-051-11 (teto de retentativas dos criativos); resolver o drift de migrations `20260928*`.

Regra combinada: **só commitar quando tudo estiver verde** (tsc, lint sem erros, vitest em banco `*_test` novo, QA aprovado); nunca
rodar `migrate dev` neste banco.
