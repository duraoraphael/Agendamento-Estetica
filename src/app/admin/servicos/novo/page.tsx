import { ServiceForm } from "@/components/ServiceForm";
import { isStorageConfigured } from "@/lib/storage";
import { loadPriceByTypeEnabled } from "@/lib/pricing-data";

export default async function NovoServicoPage() {
  const enabled = await loadPriceByTypeEnabled();
  return (
    <div className="space-y-4">
      <h1 className="page-title">Novo <span className="accent">serviço</span></h1>
      <ServiceForm storageConfigured={isStorageConfigured()} priceByType={{ enabled, table: {} }} />
    </div>
  );
}
