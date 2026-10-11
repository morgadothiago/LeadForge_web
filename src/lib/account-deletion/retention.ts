/**
 * SPEC-054a (D-054-4, **INFERRED — PRECISA DE VALIDACAO JURIDICA DO USUARIO/ADVOGADO ANTES DE PRODUCAO**).
 *
 * Fonte UNICA do que a exclusao apaga / anonimiza / retem. O e-mail #14 (`account-deleted`) lista exatamente
 * estes itens, e `purge.ts` implementa exatamente isto (teste cruzando template x comportamento em
 * `account-deletion.test.ts`). Alterar um lado exige alterar o outro.
 *
 * Retencao assumida (nao e parecer juridico):
 * - Registros fiscais/financeiros da ORGANIZACAO (assinatura, eventos de pagamento `WebhookEvent`): 5 anos.
 *   Sao dado da organizacao, nao do usuario; o e-mail do usuario e redigido dos payloads (`[removido]`).
 * - Logs de acesso/auditoria vinculados ao usuario (`IntegrationAuditLog`): 6 meses (Marco Civil, art. 15);
 *   depois sao apagados pela propria purga (`purgeRetainedUserLogs`).
 */
export const RETAIN_BILLING_YEARS = 5;
export const RETAIN_ACCESS_LOGS_MONTHS = 6;
/** 6 meses = 183 dias (aprox., sem calendario). */
export const RETAIN_ACCESS_LOGS_MS = 183 * 24 * 3600_000;

export const DELETED_ITEMS: readonly string[] = [
  "seu vínculo (participação) com as organizações",
  "contas de e-mail conectadas por você, com as credenciais guardadas",
  "tokens de redefinição de senha",
  "dispositivos e sessões do aplicativo móvel",
  "arquivos enviados por você que não estão em uso em criativos da organização",
  "registros de e-mails de sistema ligados à sua conta",
];

export const ANONYMIZED_ITEMS: readonly string[] = [
  "seu nome, e-mail, senha e foto de perfil",
  "a autoria de campanhas, criativos e arquivos em uso, que passa a constar como \"Usuário removido\"",
  "a autoria de convites e registros de auditoria da organização (autor/alvo sem identificação)",
  "seu e-mail nos registros de cobrança da organização",
];

export const RETAINED_ITEMS: readonly string[] = [
  "a linha do seu usuário no sistema, mantida só de forma anonimizada (nome \"Usuário removido\", e-mail e senha removidos), para preservar a integridade dos registros que apontam para ela",
  "o registro do pedido de exclusão (identificador interno do usuário e o hash irreversível do seu e-mail), como comprovante de que a solicitação foi atendida",
  "o identificador do autor das reuniões que você criou (aponta apenas para o usuário anonimizado)",
  "o identificador do autor dos criativos que você criou (aponta apenas para o usuário anonimizado)",
  `registros de cobrança e pagamento da organização (assinatura e eventos de pagamento), por ${RETAIN_BILLING_YEARS} anos, por obrigação fiscal/financeira`,
  `registros de auditoria de integrações vinculados à sua conta (sem seu nome/e-mail), por ${RETAIN_ACCESS_LOGS_MONTHS} meses (Marco Civil da Internet, art. 15)`,
];
