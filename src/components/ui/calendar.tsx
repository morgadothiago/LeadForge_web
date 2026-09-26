"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { ptBR } from "react-day-picker/locale";
import { cn } from "@/lib/utils";

/** shadcn Calendar (react-day-picker) so como seletor de data / mini-mes. Semana na segunda, pt-BR, tema escuro por tokens. */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={ptBR}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col gap-4",
        month: "flex w-full flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center px-8 text-sm font-medium capitalize",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: "inline-flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 outline-none",
        button_next: "inline-flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 outline-none",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-[0.75rem] font-normal capitalize text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "size-9 p-0 text-center text-sm",
        day_button: "inline-flex size-9 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
        today: "[&>button]:border [&>button]:border-primary/60",
        outside: "text-muted-foreground/50",
        disabled: "opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => (orientation === "left" ? <ChevronLeft aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />),
      }}
      {...props}
    />
  );
}
