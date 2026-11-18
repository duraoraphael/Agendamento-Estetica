"use client";

import dynamic from "next/dynamic";

// O Recharts (~100 kB de JavaScript) só é necessário para desenhar o gráfico. Carregá-lo à parte deixa
// os totais e a navegação do faturamento utilizáveis antes do gráfico, em vez de esperar todo o pacote.
const BillingChart = dynamic(() => import("@/components/BillingChart").then((m) => m.BillingChart), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-surface-2" role="status" aria-label="Carregando gráfico" />,
});

export function BillingChartLazy(props: { data: { label: string; cents: number }[] }) {
  return <BillingChart {...props} />;
}
