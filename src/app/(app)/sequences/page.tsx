import Link from "next/link";
import { FileText, Plus, Workflow } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SequenceActions } from "@/components/sequences/SequenceActions";
import { listSequences } from "@/lib/queries/sequences";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sequences = await listSequences();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/sequences/templates" className={buttonVariants({ variant: "outline" })}>
          <FileText /> Templates
        </Link>
        <Link href="/sequences/nova" className={buttonVariants()}>
          <Plus /> Nova sequência
        </Link>
      </div>

      {sequences.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Workflow className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Nenhuma sequência ainda</p>
          <p className="text-sm text-muted-foreground">Monte uma cadência de contatos para automatizar seus follow-ups.</p>
          <Link href="/sequences/nova" className={cn(buttonVariants(), "mt-2")}>
            <Plus /> Nova sequência
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sequences.map((s) => (
            <li key={s.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="min-w-0">
                  <Link href={`/sequences/${s.id}`} className="block truncate font-heading text-base font-semibold hover:underline">
                    {s.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.stepCount} passo{s.stepCount === 1 ? "" : "s"}
                    {s.days.length > 0 && <> · dias {s.days.join(", ")}</>}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {s.campaignCount === 0
                    ? "Nenhuma campanha usa esta sequência"
                    : `${s.campaignCount} campanha${s.campaignCount === 1 ? "" : "s"} (${s.activeCampaignCount} ativa${s.activeCampaignCount === 1 ? "" : "s"})`}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Link href={`/sequences/${s.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Editar
                  </Link>
                  <SequenceActions id={s.id} name={s.name} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
