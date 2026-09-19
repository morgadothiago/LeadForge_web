"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const LOST_REASON_MAX = 500;

export function LostReasonDialog({
  leadName,
  onConfirm,
  onCancel,
}: {
  leadName: string;
  /** reason null = "Perder sem motivo". */
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState("");
  const uid = React.useId();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const confirm = () => onConfirm(text.trim() || null);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent initialFocus={ref}>
        <DialogHeader>
          <DialogTitle>Motivo da perda (opcional)</DialogTitle>
          <DialogDescription>{leadName} será movido para Perdido. Esc ou Cancelar mantém a posição atual.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor={`${uid}-r`} className="text-sm font-medium">
            Por que a oportunidade foi perdida?
          </label>
          <textarea
            ref={ref}
            id={`${uid}-r`}
            rows={4}
            maxLength={LOST_REASON_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${uid}-c`}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
          <p id={`${uid}-c`} className="text-right text-xs text-muted-foreground" aria-live="polite">
            {text.length}/{LOST_REASON_MAX}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => onConfirm(null)}>
            Perder sem motivo
          </Button>
          <Button onClick={confirm}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
