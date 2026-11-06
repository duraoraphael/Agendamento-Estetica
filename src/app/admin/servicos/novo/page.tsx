import { ServiceForm } from "@/components/ServiceForm";

export default function NovoServicoPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-plum sm:text-3xl">Novo serviço</h1>
      <ServiceForm />
    </div>
  );
}
