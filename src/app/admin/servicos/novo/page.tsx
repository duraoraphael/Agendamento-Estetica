import { ServiceForm } from "@/components/ServiceForm";
import { isStorageConfigured } from "@/lib/storage";

export default function NovoServicoPage() {
  return (
    <div className="space-y-4">
      <h1 className="page-title">Novo <span className="accent">serviço</span></h1>
      <ServiceForm storageConfigured={isStorageConfigured()} />
    </div>
  );
}
