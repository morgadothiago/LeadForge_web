import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando agentes" className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>
    </div>
  );
}
