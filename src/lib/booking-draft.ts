import { cookies } from "next/headers";
import { notesSchema } from "./validation";

/**
 * Rascunho das observações entre a etapa "Veículo" e a "Revisão". Texto livre NÃO vai na URL (iria para histórico do
 * navegador, logs de acesso e cabeçalho Referer): fica num cookie httpOnly de curta duração, restrito ao fluxo de
 * agendamento. É dado da própria cliente e é validado DE NOVO na confirmação (notesSchema), então adulterar o cookie
 * não ultrapassa nenhuma regra. Nunca guarda placa nem outros dados: só o texto das observações.
 */
const COOKIE = "gzz_notes";
const MAX_AGE_SECONDS = 30 * 60;

export async function setNotesDraft(notes: string | null): Promise<void> {
  const store = await cookies();
  if (!notes) {
    store.delete(COOKIE);
    return;
  }
  store.set(COOKIE, encodeURIComponent(notes), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/agendar",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Observações guardadas (já validadas) ou null. */
export async function getNotesDraft(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || raw.length > 4_000) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parsed = notesSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export async function clearNotesDraft(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
