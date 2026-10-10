import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando conta" className="space-y-4">
      <Skeleton className="h-8 w-full max-w-xs" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
