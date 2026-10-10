"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, MailX, ShieldCheck, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { changeMemberRole, disableJoinCode, removeMember, revokeInvite, type MemberRow, type TeamView } from "@/lib/actions/org";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { JoinCodeDialog } from "./JoinCodeDialog";
import { countOwners, formatDate, joinCodeState, joinCodeSummary, roleLabel } from "./org-format";

type Pending = { kind: "remove" | "promote" | "demote"; member: MemberRow } | { kind: "disable-code" } | null;

/**
 * SPEC-049b — Configurações > Equipe. `owner` gerencia (convidar, código, papel, remover, revogar); `member` vê a
 * lista somente leitura (o servidor já devolve `invites: []`/`joinCode: null` para ele). A UI desabilita rebaixar/
 * remover o último owner, mas a barreira real é o servidor (D-049-1/12).
 */
export function TeamPanel({ team }: { team: TeamView }) {
  const router = useRouter();
  const isOwner = team.orgRole === "owner";
  const owners = countOwners(team.members);
  const [confirm, setConfirm] = React.useState<Pending>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const close = (o: boolean) => {
    if (!o) {
      setConfirm(null);
      setError(undefined);
    }
  };

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    setError(undefined);
    const res =
      confirm.kind === "disable-code"
        ? await disableJoinCode()
        : confirm.kind === "remove"
          ? await removeMember({ userId: confirm.member.userId })
          : await changeMemberRole({ userId: confirm.member.userId, orgRole: confirm.kind === "promote" ? "owner" : "member" });
    setBusy(false);
    if (res.ok) {
      toast.success(
        confirm.kind === "disable-code" ? "Código de entrada desativado." : confirm.kind === "remove" ? "Membro removido." : "Papel atualizado.",
      );
      setConfirm(null);
      router.refresh();
      return;
    }
    setError(getFormError(res.errors));
  }

  async function onRevoke(id: string) {
    setRevoking(id);
    const res = await revokeInvite({ inviteId: id });
    setRevoking(null);
    if (res.ok) {
      toast.success("Convite revogado.");
      router.refresh();
    } else toast.error(getFormError(res.errors, "Não foi possível revogar o convite."));
  }

  const dialog = confirmCopy(confirm);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Equipe</h2>
          <p className="text-sm text-muted-foreground">
            {isOwner ? "Convide pessoas, defina papéis e controle quem acessa esta organização." : "Pessoas desta organização. Só proprietários podem alterar a equipe."}
          </p>
        </div>
        {isOwner && <InviteMemberDialog />}
      </div>

      <section aria-labelledby="members-h" className="space-y-3">
        <h3 id="members-h" className="font-heading text-base font-semibold">
          Membros <span className="text-sm font-normal text-muted-foreground">({team.members.length})</span>
        </h3>
        {team.members.length === 0 ? (
          <EmptyCard icon={<Users aria-hidden="true" className="size-8 text-muted-foreground" />} title="Nenhum membro encontrado" />
        ) : (
          <ul className="grid gap-2" aria-label="Membros da organização">
            {team.members.map((m) => {
              const lastOwner = m.orgRole === "owner" && owners <= 1;
              return (
                <li key={m.userId}>
                  <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {m.name}
                        {m.isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">{m.email}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Entrou em {formatDate(m.joinedAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={m.orgRole === "owner" ? "default" : "muted"}>
                        {m.orgRole === "owner" && <ShieldCheck aria-hidden="true" className="size-3" />}
                        {roleLabel(m.orgRole)}
                      </Badge>
                      {isOwner && (
                        <>
                          {m.orgRole === "member" ? (
                            <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: "promote", member: m })}>
                              Tornar proprietário
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={lastOwner}
                              title={lastOwner ? "A organização precisa de ao menos um proprietário." : undefined}
                              onClick={() => setConfirm({ kind: "demote", member: m })}
                            >
                              Tornar membro
                            </Button>
                          )}
                          {!m.isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={lastOwner}
                              aria-label={`Remover ${m.name}`}
                              onClick={() => setConfirm({ kind: "remove", member: m })}
                            >
                              <UserMinus aria-hidden="true" /> Remover
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {!isOwner && <p className="text-xs text-muted-foreground">Para sair da organização, use Minhas organizações no menu do usuário.</p>}
      </section>

      {isOwner && (
        <>
          <section aria-labelledby="invites-h" className="space-y-3">
            <h3 id="invites-h" className="font-heading text-base font-semibold">
              Convites pendentes <span className="text-sm font-normal text-muted-foreground">({team.invites.length})</span>
            </h3>
            {team.invites.length === 0 ? (
              <EmptyCard icon={<MailX aria-hidden="true" className="size-8 text-muted-foreground" />} title="Nenhum convite pendente" text="Convites enviados por e-mail aparecem aqui até serem aceitos ou expirarem." />
            ) : (
              <ul className="grid gap-2" aria-label="Convites pendentes">
                {team.invites.map((i) => (
                  <li key={i.id}>
                    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-medium">{i.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {roleLabel(i.orgRole)} · enviado em {formatDate(i.createdAt)} · expira em {formatDate(i.expiresAt)}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => onRevoke(i.id)} disabled={revoking !== null} aria-busy={revoking === i.id} aria-label={`Revogar convite de ${i.email}`}>
                        {revoking === i.id ? "Revogando..." : "Revogar"}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="code-h" className="space-y-3">
            <h3 id="code-h" className="font-heading text-base font-semibold">
              Código de entrada
            </h3>
            <JoinCodeCard team={team} onDisable={() => setConfirm({ kind: "disable-code" })} />
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={close}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        destructive={dialog.destructive}
        pending={busy}
        error={error}
        onConfirm={runConfirm}
      />
    </div>
  );
}

export function confirmCopy(p: Pending): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  if (!p) return { title: "", description: "", confirmLabel: "Confirmar", destructive: false };
  if (p.kind === "disable-code") {
    return { title: "Desativar o código de entrada?", description: "O código atual deixa de funcionar. Quem já entrou continua na organização.", confirmLabel: "Desativar código", destructive: true };
  }
  const who = p.member.name;
  if (p.kind === "remove") {
    return { title: `Remover ${who}?`, description: "A pessoa perde o acesso a esta organização imediatamente. Para voltar, precisará de um novo convite ou do código.", confirmLabel: "Remover da organização", destructive: true };
  }
  if (p.kind === "promote") {
    return { title: `Tornar ${who} proprietário?`, description: "Proprietários convidam e removem pessoas, alteram papéis, gerem o código de entrada e a assinatura.", confirmLabel: "Tornar proprietário", destructive: false };
  }
  return { title: `Tornar ${who} membro?`, description: p.member.isSelf ? "Você perde as permissões de proprietário desta organização." : "A pessoa perde as permissões de proprietário.", confirmLabel: "Tornar membro", destructive: true };
}

function EmptyCard({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) {
  return (
    <Card className="flex flex-col items-center gap-1.5 p-8 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      {text && <p className="max-w-sm text-xs text-muted-foreground">{text}</p>}
    </Card>
  );
}

function JoinCodeCard({ team, onDisable }: { team: TeamView; onDisable: () => void }) {
  const code = team.joinCode;
  if (!code) {
    return (
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum código ativo. Gere um código para que pessoas entrem como membros sem convite por e-mail.</p>
        </div>
        <JoinCodeDialog rotate={false} />
      </Card>
    );
  }
  const state = joinCodeState(code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <code aria-label="Código de entrada" className="select-all break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-base tracking-wider">
          {code.code}
        </code>
        <Button variant="outline" size="sm" onClick={copy} disabled={state !== "active"}>
          <Copy aria-hidden="true" /> Copiar
        </Button>
        <Badge variant={state === "active" ? "default" : "destructive"}>{state === "active" ? "Ativo" : state === "expired" ? "Expirado" : "Usos esgotados"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{joinCodeSummary(code)}. Quem usa o código entra como membro, sem aprovação.</p>
      <div className="flex flex-wrap gap-2">
        <JoinCodeDialog rotate />
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDisable}>
          Desativar
        </Button>
      </div>
    </Card>
  );
}
