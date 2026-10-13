# SPEC-070 — Spike: validar provedor de vídeo com avatar (voz e lip-sync em PT-BR) antes de integrar

- id: SPEC-070
- status: **APPROVED (2026-10-13, recomendações aceitas)** | domain: backend (**sem código de produção**: spike manual + relatório em `docs/`) | criada em 2026-10-12 | depende de: 051 (interface `AvatarVideoProvider`, provedor `mock`) | bloqueia: 071, 072
- Origem: pedido do usuário "criar as specs para usar a recomendação". CONFIRMED: prototipar sem gastar, produção barata com D-ID como candidato, evitar código aberto próprio (GPU; Vercel não roda), preços de blogs de terceiros não são verdade.
- Classificação: D-070-n = INFERRED (recomendação do orquestrador). Nenhum código, schema ou migration é tocado.

## 1. Objetivo
Decidir com evidência qual provedor gera vídeo de avatar com qualidade aceitável em português do Brasil, a custo viável, com termos de uso compatíveis com LGPD/direitos de imagem. Entrega: um relatório `docs/SPIKE_PROVEDOR_AVATAR.md` com tabela comparativa, 2-3 vídeos de amostra por provedor e a decisão recomendada (provedor vencedor), que alimenta a SPEC-071.

## 2. Contexto
- Hoje só existe o provedor `mock` (SPEC-051, D-051-1): vídeo placeholder, custo 0. A interface `AvatarVideoProvider` (`src/lib/creatives/provider.ts`) e o runner por polling já existem; falta um adaptador real.
- Candidatos: **D-ID** (API Talks/Clips, PT-BR; recomendado para produção), **deAPI** (crédito grátis de ~US$ 5 sem cartão) e **Magic Hour** (plano grátis) apenas para prototipar. Opcional se o spike reprovar todos: HeyGen, Synthesia, Azure Speech Avatar.
- **Todos os preços, créditos grátis e limites citados neste pedido vieram de blogs de terceiros: são PLACEHOLDER.** Cada valor deve ser conferido na página oficial do provedor (com URL e data de consulta registradas no relatório) antes de virar decisão.

## 3. Escopo
1. Criar contas de teste com e-mail da empresa; **nenhum cartão** nos créditos grátis; chave guardada em `~/.leadforge-secrets/` (700), nunca no chat, no repositório ou no `.env` versionado.
2. Gerar 2-3 vídeos por provedor com **o mesmo roteiro PT-BR** (3 roteiros fixos: ~15 s saudação/prospecção; ~30 s com números, siglas, nome de empresa e CNPJ/telefone; ~45 s com perguntas e frases longas), mesmo formato (9:16 e 16:9 em ao menos um).
3. Avaliar com a rubrica da seção 4, por duas pessoas (cega ao provedor quando possível), nota 1-5 por critério.
4. Conferir na página oficial: preço por minuto/crédito, o que é cobrado em falha, limite de duração, marca d'água por plano, termos de uso, política de privacidade/DPA, retenção de vídeo, uso de avatares (direitos de imagem), região de dados, SLA, rate limit e idempotência da API.
5. Redigir o relatório com decisão recomendada e riscos residuais.

## 4. Critérios objetivos (rubrica; limiares são INFERRED, ajustáveis na aprovação)
| Critério | Como medir | Aprovado se |
|---|---|---|
| Pronúncia PT-BR | ouvir os 3 roteiros; contar erros por 100 palavras (números, siglas, nomes, acentuação, sotaque) | ≤ 3 erros/100 palavras e sotaque brasileiro (não português de Portugal), nota média ≥ 4 |
| Lip-sync | revisão quadro a quadro de 10 s; sincronia boca/áudio, olhos, estabilidade do rosto | nota média ≥ 4 e sem deriva visível ao fim |
| Naturalidade da voz | prosódia, pausas, entonação, estilo adequado a vendas | nota média ≥ 3,5 |
| Latência | tempo entre `create` e `done` para 15/30/45 s, 3 medições | mediana ≤ 5 min para 30 s (o runner pede polling, não é interativo) |
| Custo por minuto | preço oficial de plano/crédito ÷ minutos efetivos, incluindo vídeo falho/refeito | cabe no teto de custo por plano da SPEC-069 (ver Q-070-2) |
| Marca d'água | inspeção visual | sem marca d'água no plano de produção escolhido (grátis pode ter, só no spike) |
| Termos/LGPD/direitos de imagem | leitura dos termos e DPA; avatares de catálogo licenciados para uso comercial e publicidade; proibição de clonagem sem consentimento | uso comercial permitido; sem exigência incompatível com LGPD; dados do lead (roteiro) não usados para treino |
| Retenção de vídeo | quanto tempo o vídeo fica no provedor, se há exclusão por API | exclusão por API ou retenção curta; nosso Blob é a cópia mestre (SPEC-050) |
| API | idempotência/`Idempotency-Key`, status/polling, webhook, cancelamento, erros 429/5xx, `Retry-After`, URL de download (host/CDN, expiração) | polling funcional, URL https com host previsível (allowlist SSRF, ver `provider.ts`), erros distinguíveis retryable/definitivo |
| Moderação | provedor bloqueia conteúdo? o que acontece com roteiro rejeitado | rejeição retorna erro claro (vira `provider_rejected`) |

## 5. Entregáveis
- `docs/SPIKE_PROVEDOR_AVATAR.md`: tabela de rubrica preenchida, links oficiais e data de consulta, custo real medido, decisão, riscos, "como reproduzir".
- Amostras de vídeo guardadas **fora do repositório** (por exemplo `~/.leadforge-secrets/` ou pasta local), só referenciadas no relatório.
- Nenhum arquivo em `src/`, `prisma/`, `.env*`.

## 6. Fora do escopo
Integrar qualquer API no app, escrever adaptador, clonagem de voz/avatar próprio, código aberto auto-hospedado (SadTalker/Wav2Lip/MuseTalk: exige GPU, Vercel não roda; descartado salvo nova decisão), comprar plano pago (o spike é sem custo; compra só com aprovação).

## 7. Critérios de aceitação
- Relatório com os 9 critérios preenchidos para cada provedor testado (mínimo 2: um barato de prototipagem e D-ID).
- Todo preço/limite marcado como **conferido em página oficial (URL + data)** ou **PLACEHOLDER**.
- Decisão explícita do provedor vencedor, ou "nenhum aprovou" com próximos passos.
- Zero chave em repositório, log ou chat (verificável com `git grep` de padrões de chave antes de fechar).

## 8. Segurança e riscos
- Vazamento de chave (guardar fora do repo; revogar chaves do spike ao terminar).
- Roteiros de teste sem dado pessoal real (usar leads fictícios; LGPD).
- Imagem de pessoa real: usar só avatares de catálogo, sem subir foto de terceiros.
- Crédito grátis pode ter termos de "só teste, não comercial": registrar, vídeos do spike não vão para cliente.
- Custo escondido (cobrança por vídeo falho, mínimo de assinatura) e preço de blog desatualizado.

## 9. Decisões e perguntas
- D-070-1 (INFERRED): vencer = nota mínima de todos os critérios eliminatórios (pronúncia, lip-sync, termos/LGPD, API com polling) e melhor custo/minuto entre os aprovados.
- D-070-2 (INFERRED): se D-ID e o barato empatarem em qualidade, preferir o que tem API estável com idempotência, mesmo custando um pouco mais.
- **Q-070-1 [BLOQUEANTE]** Quem cria as contas e guarda as chaves do spike? Recomendação: o usuário cria (e-mail da empresa, sem cartão) e grava a chave com script local sem eco; o agente nunca vê o valor.
- Q-070-2 [BLOQUEANTE] Teto de custo por vídeo/minuto aceitável? Recomendação: derivar do plano Pro (20 criativos/mês, SPEC-069) com margem; calcular no relatório, valores PLACEHOLDER até conferência.
- Q-070-3 Aceita-se spike com avatar de catálogo apenas (sem foto própria)? Recomendação: sim.
- Q-070-4 Quem avalia a rubrica? Recomendação: o usuário + uma pessoa nativa de PT-BR.

## 10. Testes
Não há testes automatizados (sem código). Validação = checklist da seção 7 revisada pelo usuário.
