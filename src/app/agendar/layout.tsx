import { requireClient } from "@/lib/session";
import { ClientNav } from "@/components/ClientNav";

export default async function AgendarLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClient();
  return (
    <div className="min-h-screen">
      <ClientNav name={user.name ?? "Cliente"} />
      {children}
    </div>
  );
}
