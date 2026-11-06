import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ServiceForm } from "@/components/ServiceForm";

export default async function EditarServicoPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15: params é assíncrono (em Next 14 o await é inofensivo).
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id: id } });
  if (!service) notFound();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-plum sm:text-3xl">Editar serviço</h1>
      <ServiceForm service={service} />
    </div>
  );
}
