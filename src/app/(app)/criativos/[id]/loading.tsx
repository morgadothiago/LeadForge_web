import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando criativo" className="mx-auto max-w-4xl space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
