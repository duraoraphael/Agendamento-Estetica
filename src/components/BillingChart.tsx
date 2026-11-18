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
      <p className="rounded-xl border border-dashed border-brand/60 bg-surface/60 py-10 text-center text-sm text-fg-muted">
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
            {/* Tooltip escuro com texto off-white (contraste ≥ 10:1); também aparece ao focar/tocar na barra. */}
            <Tooltip
              cursor={{ fill: "rgba(255,202,5,0.12)" }}
              formatter={(value: number) => [formatCents(value), seriesLabel]}
              contentStyle={{ borderRadius: 12, border: `1px solid ${chartColors.primary}`, fontSize: 13, background: chartColors.tooltipBg, color: chartColors.tooltipText }}
              labelStyle={{ color: chartColors.tooltipText, fontWeight: 700 }}
              itemStyle={{ color: chartColors.primary }}
            />
            <Bar isAnimationActive={false} dataKey="cents" name={seriesLabel} fill={chartColors.primary} radius={[8, 8, 0, 0]} maxBarSize={52} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
        <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: chartColors.primary }} />
        {seriesLabel}
      </figcaption>
    </figure>
  );
}
