import { getSession } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";

/** Cabeçalho para páginas de servidor: descobre se há sessão e entrega ao `SiteHeader` (cliente). */
export async function PublicHeader() {
  const session = await getSession();
  return <SiteHeader signedIn={Boolean(session?.user)} role={session?.user?.role ?? null} />;
}
