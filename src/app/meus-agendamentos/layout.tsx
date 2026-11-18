import { requireClient } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";

export default async function MeusAgendamentosLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClient();
  return (
    <div className="min-h-screen">
      <SiteHeader signedIn role={user.role} />
      {children}
    </div>
  );
}
