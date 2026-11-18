import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";
import { prisma } from "./db";
import type { Role } from "./types";

/**
 * Sessão da requisição atual. `cache` do React deduplica por requisição: layout e página (e várias
 * chamadas de requireAdmin/requireClient) decodificam o JWT e consultam o banco UMA vez só.
 * O escopo é a própria requisição, então nada é compartilhado entre usuárias.
 */
export const getSession = cache(async () => getServerSession(authOptions));

const roleInDb = cache(async (userId: string) =>
  prisma.user.findUnique({ where: { id: userId }, select: { role: true, sessionVersion: true } })
);

/** Garante que existe uma sessão válida; caso contrário redireciona para o login. */
export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  // O JWT dura 7 dias e carrega o papel: confere no banco para que conta removida ou rebaixada
  // perca o acesso imediatamente, sem esperar o token expirar.
  const current = await roleInDb(session.user.id);
  // `sessionVersion` sobe a cada redefinição/troca de senha: tokens emitidos antes (inclusive em outros aparelhos) deixam de valer.
  if (!current || current.role !== session.user.role || current.sessionVersion !== (session.user.sessionVersion ?? 0)) {
    redirect("/login");
  }
  return session.user;
}

/** Garante que a sessão é de uma administradora; caso contrário redireciona. */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== ("ADMIN" as Role)) {
    redirect("/meus-agendamentos");
  }
  return user;
}

/** Garante que a sessão é de uma cliente (CLIENTE); admins usam o painel próprio. */
export async function requireClient() {
  const user = await requireUser();
  if (user.role !== ("CLIENTE" as Role)) {
    redirect("/admin");
  }
  return user;
}

/**
 * Versão para Route Handlers (app/api/**\/route.ts), onde next/navigation#redirect
 * não se aplica. Retorna null em vez de redirecionar — quem chama decide a resposta HTTP.
 */
export async function getAdminApiUser() {
  const session = await getSession();
  if (!session?.user || session.user.role !== ("ADMIN" as Role)) return null;
  // Confere no banco: administradora removida ou rebaixada perde o acesso na hora.
  const current = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, sessionVersion: true } });
  if (!current || current.role !== "ADMIN" || current.sessionVersion !== (session.user.sessionVersion ?? 0)) return null;
  return session.user;
}
