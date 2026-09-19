"use client";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      toastOptions={{
        classNames: {
          toast: "!bg-card !text-foreground !border-border",
        },
      }}
      {...props}
    />
  );
}
