"use client";

import { useEffect } from "react";
import { markNotificationsSeenAction } from "@/app/admin/agendamentos/actions";

/**
 * Marca os novos agendamentos como vistos quando a administradora realmente
 * abre a lista. Roda no navegador (useEffect), então pré-carregar ou renderizar
 * a página no servidor nunca grava no banco.
 */
export function MarkNotificationsSeen({ hasNew }: { hasNew: boolean }) {
  useEffect(() => {
    if (hasNew) void markNotificationsSeenAction();
  }, [hasNew]);
  return null;
}
