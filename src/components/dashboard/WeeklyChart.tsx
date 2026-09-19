"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyPoint } from "@/lib/queries/dashboard";

const SERIES = [
  { key: "newLeads", label: "Leads novos", color: "var(--stage-novo-lead)" },
  { key: "sent", label: "Enviados", color: "var(--primary)" },
  { key: "replies", label: "Respostas", color: "var(--stage-interessado)" },
] as const;

function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

export function WeeklyChart({ data }: { data: WeeklyPoint[] }) {
  const rows = data.map((p) => ({ ...p, label: dayLabel(p.date) }));
  const total = (k: (typeof SERIES)[number]["key"]) => data.reduce((a, p) => a + p[k], 0);
  const summary = SERIES.map((s) => `${total(s.key)} ${s.label.toLowerCase()}`).join(", ");
  return (
    <figure>
      <figcaption className="sr-only">Atividade dos últimos 7 dias: {summary}.</figcaption>
      <div className="h-56 w-full sm:h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: "var(--accent)" }}
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }}
            />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
        {SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Atividade diária dos últimos 7 dias</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            {SERIES.map((s) => (
              <th key={s.key} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.date}>
              <th scope="row">{dayLabel(p.date)}</th>
              {SERIES.map((s) => (
                <td key={s.key}>{p[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
