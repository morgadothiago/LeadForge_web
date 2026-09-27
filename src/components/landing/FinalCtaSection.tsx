import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FinalCtaSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="rounded-2xl bg-primary px-6 py-14 text-center shadow-xl shadow-primary/20 sm:px-12 sm:py-20">
        <h2 className="font-heading text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
          Pronto para prospectar no piloto automático?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-base text-primary-foreground sm:text-lg">
          Crie sua conta em minutos e monte sua primeira campanha ainda hoje.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "lg", pill: true }), "gap-2 bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
          >
            Começar agora
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
