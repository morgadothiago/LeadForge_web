import Link from "next/link";
import { TemplateManager } from "@/components/sequences/TemplateManager";
import { listCampaigns } from "@/lib/queries/campaigns";
import { listTemplates } from "@/lib/queries/sequences";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).campaignId;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const campaigns = await listCampaigns({});
  const current = campaigns.find((c) => c.id === wanted) ?? campaigns[0];
  const templates = current ? await listTemplates(current.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold">Templates de mensagem</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Templates pertencem a uma campanha. Variáveis permitidas: name, firstName, company, email, phone e website, no formato {"{{name}}"}.
        </p>
      </div>
      {!current ? (
        <p className="text-sm text-muted-foreground">Crie uma campanha primeiro para cadastrar templates.</p>
      ) : (
        <>
          <nav aria-label="Campanha" className="flex flex-wrap gap-1.5">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/sequences/templates?campaignId=${c.id}`}
                aria-current={c.id === current.id ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  c.id === current.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.name}
              </Link>
            ))}
          </nav>
          <TemplateManager
            key={current.id}
            campaignId={current.id}
            templates={templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body, usedInSteps: t.usedInSteps }))}
          />
        </>
      )}
    </div>
  );
}
