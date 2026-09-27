"use client";

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";

/**
 * SPEC-035 — cartão de produto ilustrativo do hero (motivo visual "donut chart + chips de %" pedido
 * pelo usuário). Dados 100% estáticos/ilustrativos, sem ligação com dado real (a SPEC deixa isso
 * explícito: "usar dados ilustrativos estáticos, não conectados a dado real").
 */
const DONUT_DATA = [
  { name: "Respondidos", value: 42, color: "var(--primary)" },
  { name: "Em sequência", value: 31, color: "var(--accent-foreground)" },
  { name: "Aguardando", value: 27, color: "var(--muted-foreground)" },
];

const METRICS = [
  { label: "Leads qualificados", value: "1.284", change: "+18%", positive: true },
  { label: "Reuniões agendadas", value: "96", change: "+9%", positive: true },
  { label: "Taxa de resposta", value: "31%", change: "-2%", positive: false },
] as const;

export function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
    >
      <Card className="w-full max-w-md rounded-2xl border-border/60 bg-card p-5 shadow-xl shadow-primary/10 sm:p-6" aria-hidden="true">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Campanha · ICP Fintechs BR</p>
            <p className="font-heading text-lg font-semibold">Performance de prospecção</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-accent-foreground">IA</div>
        </div>

        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-4">
          <div className="relative size-28 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={DONUT_DATA} dataKey="value" nameKey="name" innerRadius={34} outerRadius={52} paddingAngle={3} stroke="none">
                  {DONUT_DATA.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold tabular-nums">72%</span>
              <span className="text-[10px] text-muted-foreground">engajamento</span>
            </div>
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {DONUT_DATA.map((d) => (
              <li key={d.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name}
              </li>
            ))}
          </ul>
        </div>

        <ul className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
          {METRICS.map((m) => (
            <li key={m.label} className="space-y-1">
              <p className="text-[11px] leading-tight text-muted-foreground">{m.label}</p>
              <p className="text-base font-bold tabular-nums">{m.value}</p>
              <span
                className={
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
                  (m.positive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")
                }
              >
                {m.positive ? <ArrowUpRight size={11} aria-hidden="true" /> : <ArrowDownRight size={11} aria-hidden="true" />}
                {m.change}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </motion.div>
  );
}
