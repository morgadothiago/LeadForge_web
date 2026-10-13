# SPEC-072 — UI de Criativos com provedor real: faixa de demonstração, custo estimado e limites — frontend

- id: SPEC-072
- status: **DRAFT** (aguardando `APROVAR SPEC-072`; depende de 071 `IMPLEMENTED`) | domain: frontend | criada em 2026-10-12 | depende de: 051b (UI de criativos), 071 (provedor real, custo), 069 (limites/CTA de upgrade, `plan_feature_locked`), 067 (toasts)
- Classificação: D-072-n = INFERRED. Nenhum código escrito.

## 1. Objetivo
Ajustar a interface de Criativos para o provedor real: a faixa "Provedor de demonstração (mock)" só aparece quando o provedor ativo é `mock`; mostrar custo estimado antes de enviar e custo real depois; mostrar consumo/limite do plano e bloqueio com CTA de upgrade.

## 2. Contexto (lido do código)
- `src/components/creatives/creative-format.ts`: `MOCK_LABEL` ("Provedor de demonstração (mock)") e `MOCK_NOTICE` ("...placeholders de demonstração... Nenhum custo é cobrado.").
- `CreativeWizard.tsx` linha ~298: "Custo estimado" mostra `R$ 0,00 (demonstração)` se mock, senão "Informado pelo provedor após o envio". `CreativeDetail.tsx` linha ~296: usa `isMockProvider(info?.provider)` e `c.job.costEstimateCents`. Testes em `creatives-ui.test.tsx`.

## 3. Escopo (Frontend)
1. **Faixa de demonstração**: renderizar somente se `provider === "mock"`; com `did` não aparece. Texto novo opcional discreto: "Vídeo gerado por IA" (rótulo de transparência, Q-072-3), nunca o nome do provedor se Q-072-2 disser que não.
2. **Revisão no wizard**: "Custo estimado" = `estimateCostCents(duração)` formatado em R$ com aviso "estimativa; o valor final pode variar", e a **confirmação explícita** antes de enviar (checkbox/botão "Gerar vídeo (~R$ x,xx)") quando custo > 0. Mostra também "Você usou N de M criativos neste mês" (Free 0 / Starter 3 / Pro 20, SPEC-069).
3. **Detalhe do criativo**: "Custo estimado" e "Custo real" (quando `succeeded`; real ausente mostra "calculando"); sem expor dados do provedor além do nome amigável.
4. **Limites e bloqueio**: ao atingir `maxCreativesPerMonth` ou plano sem a funcionalidade, botão de criar fica `aria-disabled` com motivo ("Disponível no plano Starter/Pro"/"Você usou 3 de 3 criativos") e CTA para `/configuracoes/assinatura`; erro `plan_limit`/`plan_feature_locked` tratado por `notifyActionError` (SPEC-067/069), nunca erro genérico.
5. **Estados de falha do provedor**: mensagens PT-BR distintas para indisponível (tente mais tarde), rejeitado (roteiro não permitido: edite), falha (tentar novamente) e quota do plano.
6. **Admin (opcional, junto da 069 de admin)**: indicador "provedor ativo: did/mock" e custo do mês por org só em `/admin` (platform_admin), sem roteiro.
7. A11y/responsivo conforme SPEC-002/037: 390 e 1280 px, claro/escuro, alvos ≥ 44 px, foco visível, status por texto (não só cor).

## 4. Fora do escopo
Escolher avatar por foto, upload de imagem, edição de vídeo, BYOK na UI, página de administração de chaves (069), formatação de moeda fora de `formatCents`.

## 5. Critérios de aceitação
- Com `mock`: UI idêntica à de hoje (faixa e "R$ 0,00 (demonstração)"); testes antigos verdes.
- Com `did`: sem faixa de demonstração; custo estimado > 0 e confirmação; custo real no detalhe; consumo do plano visível.
- Plano Free/limite esgotado: botão bloqueado com motivo e CTA de upgrade; teste cobre `plan_limit` e `plan_feature_locked`.
- Validação em navegador (390/1280, claro/escuro, teclado) registrada; `tsc`, `eslint`, `vitest` verdes. Nenhuma chave ou dado de provedor chega ao cliente.

## 6. Testes
Componentes: wizard e detalhe com provedor `mock` e `did` (props/`info` simulados), formatação de custo, bloqueio por plano, a11y (`aria-disabled`, nome acessível), mensagens de erro por código. Sem rede, sem provedor real.

## 7. Riscos
Mostrar custo errado (estimativa vs real) confunde: rotular como estimativa; vazamento do nome/URL do provedor ou da chave por props: server action devolve só campos de view (`views.ts`); usuário gerar vídeo sem perceber custo: confirmação obrigatória.

## 8. Decisões e perguntas
- D-072-1 (INFERRED): custo exibido em R$ para o tenant só como informação de consumo (o preço ao tenant já está no plano; a plataforma absorve, Q-071-2).
- Q-072-1 [BLOQUEANTE] Mostrar custo em R$ ao tenant ou só "N de M criativos"? Recomendação: **só criativos usados/limite ao tenant**; custo em R$ só no admin. (Se escolhido, o item 2/3 muda para contagem.)
- Q-072-2 Exibir o nome do provedor ("D-ID") ao usuário? Recomendação: não; rótulo neutro "Vídeo gerado por IA".
- Q-072-3 Marca "gerado por IA" visível no vídeo/UI? Recomendação: sim na UI e no relatório; marca no vídeo conforme termos do provedor.
