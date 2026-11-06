"use client";

import { useLinkStatus } from "next/link";

/**
 * Retorno imediato ao clicar num link: um pequeno indicador girando DENTRO do link enquanto a próxima página é
 * preparada. Colocar como filho de <Link>. Ao contrário de um loading.tsx (esqueleto de página), não adiciona o
 * atraso de ~300 ms que o React aplica ao trocar um esqueleto por conteúdo que chega rápido.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 flex-none rounded-full border-2 border-current border-t-transparent transition-opacity ${
        pending ? "ml-2 animate-spin opacity-100" : "ml-0 w-0 opacity-0"
      }`}
    />
  );
}
