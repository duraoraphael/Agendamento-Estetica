import { requireAdmin } from "@/lib/session";
import { getNewAppointmentsCount } from "@/lib/admin-stats";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const newCount = await getNewAppointmentsCount(admin.id);

  return (
    <div className="min-h-screen bg-ink pb-12">
      <AdminNav adminName={admin.name ?? "Administradora"} newCount={newCount} />
      <main id="conteudo" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
