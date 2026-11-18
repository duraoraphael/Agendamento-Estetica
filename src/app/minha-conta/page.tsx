import Link from "next/link";
import { requireClient } from "@/lib/session";
import { prisma } from "@/lib/db";
import { listVehicles, vehicleLabel } from "@/lib/vehicles";
import { formatPlate } from "@/lib/plate";
import { Page, PageHeader } from "@/components/ui";
import { ProfileForm } from "@/components/ProfileForm";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { SignOutButton } from "@/components/SignOutButton";
import { CarIcon, ChevronRightIcon, PlusIcon, UserIcon, CalendarIcon } from "@/components/icons";

export const metadata = { title: "Minha conta" };

export default async function MinhaContaPage() {
  const user = await requireClient();
  const [profile, vehicles] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true, phone: true } }),
    listVehicles(user.id),
  ]);
  // Nome, e-mail e celular vêm do banco (a sessão só guarda o que existia no login).
  if (!profile) return null;

  return (
    <Page width="xl">
      <PageHeader title="Minha" accent="conta" subtitle="Gerencie seus dados e veículos cadastrados." />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="dados" className="card">
          <h2 id="dados" className="flex items-center gap-2 font-display text-2xl font-extrabold uppercase italic text-fg">
            <UserIcon className="h-7 w-7 text-brand" /> Dados pessoais
          </h2>
          <div className="mt-3">
            <ProfileForm name={profile.name} email={profile.email} phone={profile.phone} />
          </div>
        </section>

        <section aria-labelledby="veiculos" className="card">
          <h2 id="veiculos" className="flex items-center gap-2 font-display text-2xl font-extrabold uppercase italic text-fg">
            <CarIcon className="h-7 w-7 text-brand" /> Meus veículos
          </h2>
          {vehicles.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">Você ainda não cadastrou nenhum veículo.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <Link href={`/minha-conta/veiculos/${v.id}/editar`} className="flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 hover:border-brand/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-fg">{vehicleLabel(v)}</span>
                      <span className="block text-sm text-fg-muted">{formatPlate(v.plate)}</span>
                    </span>
                    <ChevronRightIcon className="h-5 w-5 text-brand" />
                    <span className="sr-only">Editar veículo</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/minha-conta/veiculos/novo" className="btn-primary mt-4 w-full">
            <PlusIcon className="h-5 w-5" /> Adicionar veículo
          </Link>
          {vehicles.length > 0 && (
            <Link href="/minha-conta/veiculos" className="link mt-3 inline-flex min-h-[44px] items-center">
              Ver todos os veículos
            </Link>
          )}
        </section>
      </div>

      <section aria-labelledby="seguranca" className="card mt-6">
        <h2 id="seguranca" className="font-display text-2xl font-extrabold uppercase italic text-fg">
          Segurança
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Para sua proteção, trocar a senha pede a senha atual e encerra as sessões abertas.</p>
        <div className="mt-4 max-w-md">
          <ChangePasswordForm />
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/meus-agendamentos" className="btn-secondary w-full sm:w-auto">
          <CalendarIcon className="h-5 w-5" /> Meus agendamentos
        </Link>
        <SignOutButton className="btn-ghost w-full sm:w-auto" />
      </div>
    </Page>
  );
}
