import { z } from "zod";

const email = z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido.").max(254);
const orgRole = z.enum(["owner", "member"], { error: "Papel inválido." });
const token = z.string({ error: "Token é obrigatório." }).trim().min(1, "Token é obrigatório.").max(512, "Token inválido.");
const id = z.string().trim().min(1).max(64);

export const switchOrganizationSchema = z.object({ orgId: id });
export const inviteMemberSchema = z.object({ email, orgRole: orgRole.default("member") });
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;
export const revokeInviteSchema = z.object({ inviteId: id });
export const acceptInviteSchema = z.object({ token });
export const joinByCodeSchema = z.object({ code: z.string({ error: "Código é obrigatório." }).trim().min(1, "Código é obrigatório.").max(64, "Código inválido.") });
export const changeMemberRoleSchema = z.object({ userId: id, orgRole });
export const removeMemberSchema = z.object({ userId: id });
export const generateJoinCodeSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
});

/** Signup por CONVITE (SPEC-062 D-062-15: o ramo por codigo saiu): token do link + nome + senha; o e-mail vem do convite. */
export const signupJoinSchema = z.object({
  name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(120),
  password: z.string({ error: "Senha é obrigatória." }).min(12, "Senha deve ter ao menos 12 caracteres.").max(256, "Senha muito longa."),
  token,
});
export type SignupJoinInput = z.input<typeof signupJoinSchema>;

/** Convite por link (aceite de usuário novo, `/convite/[token]`): só nome e senha; o e-mail vem do convite. */
export const inviteSignupFormSchema = z.object({
  name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(120),
  password: z.string({ error: "Senha é obrigatória." }).min(12, "Senha deve ter ao menos 12 caracteres.").max(256, "Senha muito longa."),
});
export type InviteSignupFormInput = z.input<typeof inviteSignupFormSchema>;

/** Convite por e-mail na aba Equipe (campos do form). */
export const inviteFormSchema = inviteMemberSchema;

/** Gerar código de entrada: validade/usos como texto (inputs numéricos) -> número. */
export const joinCodeFormSchema = z.object({
  expiresInDays: z.coerce.number({ error: "Informe a validade em dias." }).int("Use um número inteiro.").min(1, "Mínimo 1 dia.").max(30, "Máximo 30 dias."),
  maxUses: z.coerce.number({ error: "Informe o limite de usos." }).int("Use um número inteiro.").min(1, "Mínimo 1 uso.").max(100, "Máximo 100 usos."),
});
export type JoinCodeFormInput = z.input<typeof joinCodeFormSchema>;
export type JoinCodeFormOutput = z.output<typeof joinCodeFormSchema>;
