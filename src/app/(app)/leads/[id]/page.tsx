import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { InboundReply } from "@/components/leads/InboundReply";
import { PossibleOptOutAlert } from "@/components/leads/PossibleOptOutAlert";
import { LeadActions } from "@/components/leads/LeadActions";
import { LeadNotes } from "@/components/leads/LeadNotes";
import { LeadTags } from "@/components/leads/LeadTags";
import { LeadTimeline } from "@/components/leads/LeadTimeline";
import { SuppressedBadge } from "@/components/leads/SuppressedBadge";
import { formatDateTime, formatPhone, relativeTime, whatsappStatusText } from "@/components/leads/lead-format";
import { formatBRL } from "@/components/pipeline/board-state";
import { Card } from "@/components/ui/card";
import { SEQUENCE_STATUS_LABELS } from "@/lib/domain";
import { getLead, type LeadDetail } from "@/lib/queries/leads";
import { leadIdSchema } from "@/lib/schemas/lead";

export const dynamic = "force-dynamic";

function sequenceText(l: LeadDetail): string {
  switch (l.sequenceStatus) {
    case "not_started":
      return "Sequência ainda não iniciada.";
    case "active":
      return l.nextTouchAt
        ? `Sequência ativa. Próximo contato ${relativeTime(l.nextTouchAt)} (${formatDateTime(l.nextTouchAt)}).`
        : "Sequência ativa.";
    case "paused_replied":
      return `Sequência pausada: o lead respondeu${l.repliedAt ? ` ${relativeTime(l.repliedAt)} (${formatDateTime(l.repliedAt)})` : ""}.`;
    case "completed":
      return "Sequência concluída.";
    case "opted_out":
      return `Lead pediu para não ser contatado${l.optedOutAt ? ` ${relativeTime(l.optedOutAt)} (${formatDateTime(l.optedOutAt)})` : ""}. Sequência encerrada.`;
  }
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

const ext = (u: string | null) =>
  u ? (
    <a href={u} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      {u}
    </a>
  ) : null;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!leadIdSchema.safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const opp = lead.opportunity;

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Leads
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-heading text-xl font-semibold">{lead.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {opp && <StatusBadge stage={opp.stage} />}
            {lead.company && <span>{lead.company}</span>}
            <span>Score {lead.score}</span>
            {lead.suppressed && <SuppressedBadge />}
          </p>
        </div>
        <LeadActions
          stage={opp?.stage ?? null}
          suppressed={Boolean(lead.suppressed)}
          lead={{ id: lead.id, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, website: lead.website, linkedin: lead.linkedin, source: lead.source }}
        />
      </div>

      {lead.possibleOptOut && <PossibleOptOutAlert leadId={lead.id} leadName={lead.name} className="max-w-xl text-sm" />}
      {lead.lastInboundAt && (
        <Card className="p-4">
          <h3 className="mb-2 font-heading text-base font-semibold">Última resposta</h3>
          <InboundReply at={lead.lastInboundAt} text={lead.lastInboundText} max={200} className="text-sm" />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h3 className="mb-4 font-heading text-base font-semibold">Ficha</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="E-mail">{lead.email}</Item>
              <Item label="Telefone">{formatPhone(lead.phone)}</Item>
              {lead.phone && <Item label="Tem WhatsApp">{whatsappStatusText(lead.hasWhatsapp, lead.whatsappCheckedAt)}</Item>}
              <Item label="Site">{ext(lead.website)}</Item>
              <Item label="LinkedIn">{ext(lead.linkedin)}</Item>
              <Item label="Campanha">
                <Link href={`/campanhas/${lead.campaign.id}`} className="text-primary hover:underline">
                  {lead.campaign.name}
                </Link>
              </Item>
              <Item label="Origem">{lead.source}</Item>
              <Item label="Valor da oportunidade">{opp?.value != null ? formatBRL(opp.value) : null}</Item>
              <Item label="Criado em">
                <time dateTime={lead.createdAt.toISOString()}>{formatDateTime(lead.createdAt)}</time>
              </Item>
              {opp?.stage === "perdido" && <Item label="Motivo da perda">{opp.lostReason ?? "Não informado"}</Item>}
            </dl>
            <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm">{sequenceText(lead)}</p>
            <p className="sr-only">Status técnico: {SEQUENCE_STATUS_LABELS[lead.sequenceStatus]}</p>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 font-heading text-base font-semibold">Histórico de contatos</h3>
            <LeadTimeline touches={lead.touches} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="mb-4 font-heading text-base font-semibold">Tags</h3>
            <LeadTags leadId={lead.id} tags={lead.tags} />
          </Card>
          <Card className="p-5">
            <h3 className="mb-4 font-heading text-base font-semibold">Anotações</h3>
            <LeadNotes leadId={lead.id} notes={lead.notes} />
          </Card>
          <Card className="p-5">
            <h3 className="mb-4 font-heading text-base font-semibold">Reuniões</h3>
            {lead.meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma reunião.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {lead.meetings.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <time dateTime={m.scheduledAt.toISOString()}>{formatDateTime(m.scheduledAt)}</time>
                    <span className="text-muted-foreground">{m.duration} min · {m.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
