import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando pipeline" className="space-y-4">
      <Skeleton className="h-14 w-full max-w-xl" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-96 w-[280px] shrink-0 md:w-[300px]" />
        ))}
      </div>
    </div>
  );
}
