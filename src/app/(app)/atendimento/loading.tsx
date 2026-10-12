import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando atendimento" className="grid h-full min-h-[480px] gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Skeleton className="h-full w-full" />
      <Skeleton className="hidden h-full w-full lg:block" />
    </div>
  );
}
