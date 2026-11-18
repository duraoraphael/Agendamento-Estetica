import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ServiceForm } from "@/components/ServiceForm";
import { listServicePhotos } from "@/lib/service-images";
import { isStorageConfigured } from "@/lib/storage";

export default async function EditarServicoPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15: params é assíncrono (em Next 14 o await é inofensivo).
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id: id } });
  if (!service) notFound();
  const photos = await listServicePhotos(service.id, service.name);

  return (
    <div className="space-y-4">
      <h1 className="page-title">Editar <span className="accent">serviço</span></h1>
      <ServiceForm service={service} photos={photos} storageConfigured={isStorageConfigured()} />
    </div>
  );
}
