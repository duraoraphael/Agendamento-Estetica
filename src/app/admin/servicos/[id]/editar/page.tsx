import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ServiceForm } from "@/components/ServiceForm";
import { listServicePhotos } from "@/lib/service-images";
import { isStorageConfigured } from "@/lib/storage";
import { loadPriceByTypeEnabled, loadPriceTables } from "@/lib/pricing-data";
import type { VehicleType } from "@/lib/pricing";

export default async function EditarServicoPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15: params é assíncrono (em Next 14 o await é inofensivo).
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id: id } });
  if (!service) notFound();
  const photos = await listServicePhotos(service.id, service.name);
  const [enabled, tables] = await Promise.all([loadPriceByTypeEnabled(), loadPriceTables([service.id])]);
  // Reais com vírgula (como a administradora digita); categoria sem preço = campo vazio.
  const table: Partial<Record<VehicleType, string>> = {};
  for (const [type, cents] of Object.entries(tables.get(service.id) ?? {})) table[type as VehicleType] = (cents / 100).toFixed(2).replace(".", ",");

  return (
    <div className="space-y-4">
      <h1 className="page-title">Editar <span className="accent">serviço</span></h1>
      <ServiceForm service={service} photos={photos} storageConfigured={isStorageConfigured()} priceByType={{ enabled, table }} />
    </div>
  );
}
