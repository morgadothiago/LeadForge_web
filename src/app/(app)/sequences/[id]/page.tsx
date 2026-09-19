import { notFound } from "next/navigation";
import { SequenceActions } from "@/components/sequences/SequenceActions";
import { SequenceBuilder } from "@/components/sequences/SequenceBuilder";
import { loadTemplateOptions } from "@/components/sequences/load-options";
import { idSchema } from "@/lib/schemas/campaign";
import { getSequence } from "@/lib/queries/sequences";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [sequence, templates] = await Promise.all([getSequence(id), loadTemplateOptions()]);
  if (!sequence) notFound();
  const active = sequence.campaigns.filter((c) => c.status === "active").length;
  return (
    <div className="space-y-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-xl font-semibold">{sequence.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sequence.campaigns.length === 0
              ? "Nenhuma campanha usa esta sequência."
              : `Usada por ${sequence.campaigns.map((c) => c.name).join(", ")}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <SequenceActions id={sequence.id} name={sequence.name} afterDeleteHref="/sequences" />
        </div>
      </div>
      <SequenceBuilder
        key={sequence.steps.map((s) => `${s.id}:${s.day}:${s.template.id}`).join("|") + sequence.name}
        mode="edit"
        templates={templates}
        activeCampaigns={active}
        sequence={{
          id: sequence.id,
          name: sequence.name,
          steps: sequence.steps.map((s) => ({ key: s.id, id: s.id, day: s.day, channel: s.channel, templateId: s.template.id })),
        }}
      />
    </div>
  );
}
