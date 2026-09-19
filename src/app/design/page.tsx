import { notFound } from "next/navigation";
import { CHANNELS, STAGES } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { MetricCard } from "@/components/domain/MetricCard";
import { DesignInteractive } from "./interactive";

export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-4xl space-y-10 p-6">
      <h1 className="text-4xl font-bold">Design system</h1>

      <section className="animate-slide-up space-y-3">
        <h2 className="text-2xl font-semibold">Botões</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Excluir</Button>
          <Button pill>Pill</Button>
        </div>
        <Input placeholder="Campo de texto" className="max-w-sm" />
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Badges</h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => <StatusBadge key={s} stage={s} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => <ChannelBadge key={c} channel={c} />)}
          <Badge>Badge</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Métricas</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard title="Leads" value={128} trend={12} />
          <MetricCard title="Respostas" value={34} trend={-5} />
          <MetricCard title="Conversão" value="8,2%" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Tabela</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Acme Ltda</TableCell>
              <TableCell><StatusBadge stage="interessado" /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <DesignInteractive />
    </main>
  );
}
