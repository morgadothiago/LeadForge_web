import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none transition-all duration-200 ease-out placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}
