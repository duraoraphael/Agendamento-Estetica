"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/format";
import { chartColors } from "@/lib/theme";

interface ChartPoint {
  label: string;
  cents: number;
}

export function BillingChart({ data, seriesLabel = "Faturamento concluído" }: { data: ChartPoint[]; seriesLabel?: string }) {
  if (data.length === 0 || data.every((d) => d.cents === 0)) {
    return (
      <p className="rounded-xl border border-dashed border-gold/60 bg-white/60 py-10 text-center text-sm text-plum-muted">
        Sem faturamento concluído no período para exibir no gráfico.
      </p>
    );
  }

  return (
    <figure>
      <div className="h-64 w-full" role="img" aria-label={`Gráfico de barras: ${seriesLabel}. ${data.map((d) => `${d.label}: ${formatCents(d.cents)}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={chartColors.grid} />
            <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: chartColors.axis }} axisLine={{ stroke: chartColors.grid }} tickLine={false} />
            <YAxis
              tickFormatter={(v) => formatCents(v).replace(",00", "")}
              tick={{ fontSize: 12, fill: chartColors.axis }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ fill: "#F7E5EB" }}
              formatter={(value: number) => [formatCents(value), seriesLabel]}
              contentStyle={{ borderRadius: 12, border: `1px solid ${chartColors.grid}`, fontSize: 13 }}
            />
            <Bar isAnimationActive={false} dataKey="cents" name={seriesLabel} fill={chartColors.primary} radius={[8, 8, 0, 0]} maxBarSize={52} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-sm text-plum-muted">
        <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: chartColors.primary }} />
        {seriesLabel}
      </figcaption>
    </figure>
  );
}
