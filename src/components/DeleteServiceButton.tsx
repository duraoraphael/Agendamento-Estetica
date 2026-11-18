"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteServiceAction } from "@/app/admin/servicos/actions";

/**
 * "Excluir" um serviço, com confirmação em janela própria. Serviço com reservas no histórico não pode ser excluído (o
 * servidor também recusa): a janela explica e aponta "Desativar". Esc e "Cancelar" fecham sem fazer nada.
 */
export function DeleteServiceButton({
  serviceId,
  serviceName,
  appointmentCount,
  photoCount,
}: {
  serviceId: string;
  serviceName: string;
  appointmentCount: number;
  photoCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const blocked = appointmentCount > 0;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteServiceAction(serviceId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="btn-ghost text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
        aria-label={`Excluir o serviço ${serviceName}`}
      >
        Excluir
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => !busy && setOpen(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`del-${serviceId}-title`}
            aria-describedby={`del-${serviceId}-text`}
            className="card w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={`del-${serviceId}-title`} className="text-2xl text-fg">
              {blocked ? "Não é possível excluir" : "Excluir serviço?"}
            </h2>
            <p id={`del-${serviceId}-text`} className="text-fg-muted">
              {blocked ? (
                <>
                  <strong className="text-fg">{serviceName}</strong> tem {appointmentCount} {appointmentCount === 1 ? "agendamento" : "agendamentos"} no histórico. Excluir apagaria o histórico e o faturamento. Use <strong className="text-fg">Desativar</strong> para escondê-lo das clientes.
                </>
              ) : (
                <>
                  <strong className="text-fg">{serviceName}</strong> será excluído de vez
                  {photoCount > 0 ? `, junto com ${photoCount === 1 ? "a foto" : `as ${photoCount} fotos`}` : ""}. Esta ação não pode ser desfeita.
                </>
              )}
            </p>
            {error && (
              <div className="notice-error" role="alert">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={closeRef} type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
                {blocked ? "Entendi" : "Cancelar"}
              </button>
              {!blocked && (
                <button type="button" className="btn-danger" disabled={busy} onClick={() => void confirm()}>
                  {busy ? "Excluindo..." : "Sim, excluir"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
