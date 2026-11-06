import { STATUS_LABELS, STATUS_BADGE_CLASSES } from "@/lib/constants";

// Ícone por situação: a cor nunca é o único indicador (texto + forma).
const ICONS: Record<string, string> = {
  CONFIRMADA: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  CONCLUIDA: "m5 12.500 4.500 4.500L19 7.500",
  CANCELADA: "M7 7l10 10M17 7 7 17",
  FALTA: "M12 7v6M12 16.500v.01",
};

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const path = ICONS[status];
  return (
    <span className={`badge ${STATUS_BADGE_CLASSES[status] ?? "bg-status-cancelled-bg text-status-cancelled"}`}>
      {path && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.500" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={path} />
        </svg>
      )}
      {label}
    </span>
  );
}
