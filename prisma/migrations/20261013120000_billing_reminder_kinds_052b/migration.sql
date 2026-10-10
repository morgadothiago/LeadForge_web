-- SPEC-052b: novos valores de BillingReminderKind (regua D+3/D+5/D+7 e aviso de renovacao). Migration aditiva.
-- Um valor por statement; os valores NAO sao usados nesta migration (ADD VALUE nao pode ser usado na mesma transacao).
-- Reverter: valores de enum nao sao removiveis com ALTER TYPE; exigiria recriar o tipo (nao necessario, aditivo).
ALTER TYPE "BillingReminderKind" ADD VALUE 'past_due_d3';
ALTER TYPE "BillingReminderKind" ADD VALUE 'past_due_d5';
ALTER TYPE "BillingReminderKind" ADD VALUE 'past_due_d7';
ALTER TYPE "BillingReminderKind" ADD VALUE 'renewal_upcoming';
