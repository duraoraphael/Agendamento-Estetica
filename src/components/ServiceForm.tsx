"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { upsertServiceAction, type ServiceFormState } from "@/app/admin/servicos/actions";
import { ServicePhotos, type AdminPhoto, type ServicePhotosHandle, type UploadReport } from "@/components/ServicePhotos";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, parseReaisToCents, type VehicleType } from "@/lib/pricing";
import { formatCents } from "@/lib/format";

interface ServiceFormProps {
  /** Chave "Cobrar por tipo de veículo" e os preços por categoria já salvos (em reais, com vírgula). */
  priceByType?: { enabled: boolean; table: Partial<Record<VehicleType, string>> };
  service?: {
    id: string;
    name: string;
    priceCents: number;
    durationMinutes: number;
    active: boolean;
  };
  /** Fotos já salvas do serviço (só na edição). */
  photos?: AdminPhoto[];
  /** Falso quando SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não estão configuradas no servidor. */
  storageConfigured?: boolean;
}

export function ServiceForm({ service, photos = [], storageConfigured = true, priceByType }: ServiceFormProps) {
  const router = useRouter();
  const [state, formAction] = useFormState<ServiceFormState, FormData>(upsertServiceAction, null);
  const errors = state?.errors ?? {};
  const photosRef = useRef<ServicePhotosHandle>(null);
  // O botão "Salvar" fica fora do <form> (abaixo das fotos), então `useFormStatus` não o enxerga: o estado é local.
  const [saving, setSaving] = useState(false);
  useEffect(() => setSaving(false), [state]);

  // Controlados: o React 19 limpa campos não controlados depois da ação de servidor, e o nome é usado na tela de fotos.
  const [name, setName] = useState(service?.name ?? "");
  const [price, setPrice] = useState(service ? (service.priceCents / 100).toFixed(2).replace(".", ",") : "");
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30));
  const [active, setActive] = useState(service?.active ?? true);
  // Preço por categoria (reais, vazio = usa o padrão). Controlados pelo mesmo motivo dos campos acima.
  const [typePrices, setTypePrices] = useState<Record<VehicleType, string>>(
    () => Object.fromEntries(VEHICLE_TYPES.map((t) => [t, priceByType?.table[t] ?? ""])) as Record<VehicleType, string>
  );
  const defaultCents = parseReaisToCents(price) ?? service?.priceCents ?? 0;

  // Serviço novo: depois de salvo, o ID existe e as fotos escolhidas podem subir.
  const createdId = state?.createdId ?? null;
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!createdId || startedFor.current === createdId) return;
    startedFor.current = createdId; // uma única vez por serviço criado
    void (async () => {
      const handle = photosRef.current;
      if (!handle || handle.pendingCount() === 0) {
        router.push("/admin/servicos");
        return;
      }
      setUploading(true);
      const result = await handle.uploadPending(createdId);
      setUploading(false);
      if (result.failed.length === 0) {
        router.push("/admin/servicos");
        return;
      }
      // O serviço continua criado. A tela fica aberta para tentar de novo ou seguir sem essas fotos.
      setReport(result);
    })();
  }, [createdId, router]);

  const serviceId = service?.id ?? createdId;
  const created = Boolean(createdId);

  return (
    <div className="card space-y-6">
      {errors._form && <div className="notice-error" role="alert">{errors._form}</div>}

      {created && (
        <div className={report ? "notice-warning" : "notice-success"} role="status">
          <div>
            <p className="font-semibold">
              {uploading ? "Serviço criado. Enviando as fotos…" : report ? "Serviço criado, mas algumas fotos não foram enviadas." : "Serviço criado."}
            </p>
            {report && (
              <ul className="mt-1 list-disc pl-5">
                {report.failed.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            )}
            {report && (
              <p className="mt-2">
                Use “Tentar novamente” em cada foto, ou{" "}
                <Link href={`/admin/servicos/${createdId}/editar`} className="link">
                  abra o serviço para adicionar as fotos depois
                </Link>
                . Voltar para a{" "}
                <Link href="/admin/servicos" className="link">
                  lista de serviços
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      )}

      <form id="service-form" action={formAction} onSubmit={() => setSaving(true)} className="space-y-4">
        {service && <input type="hidden" name="id" value={service.id} />}
        <fieldset disabled={created} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">
              Nome do serviço
            </label>
            <input id="name" name="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Lavagem detalhada" />
            {errors.name && <p className="error-text">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="priceReais">
                Preço (R$)
              </label>
              <input id="priceReais" name="priceReais" required inputMode="decimal" className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="40,00" />
              {errors.priceReais && <p className="error-text">{errors.priceReais}</p>}
            </div>
            <div>
              <label className="label" htmlFor="durationMinutes">
                Duração (min)
              </label>
              <input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={5}
                step={5}
                required
                className="input"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
              {errors.durationMinutes && <p className="error-text">{errors.durationMinutes}</p>}
            </div>
          </div>

          {priceByType && (
            <div className="rounded-xl border border-line-strong p-4" role="group" aria-labelledby="preco-tipo-secao">
              <h2 id="preco-tipo-secao" className="font-display text-lg font-bold uppercase tracking-wide text-fg">
                Preço por tipo de veículo
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Deixe em branco para usar o preço padrão ({formatCents(defaultCents)}). Vale só com “Cobrar por tipo de veículo” ligado em Configurações.
              </p>
              {!priceByType.enabled && (
                <div className="notice-warning mt-3" role="status">
                  <p>
                    Cobrança por tipo desligada: estes valores ficam guardados, mas não são usados (as clientes pagam o preço padrão).{" "}
                    <Link href="/admin/configuracoes" className="font-semibold underline underline-offset-4">
                      Ligar em Configurações
                    </Link>
                  </p>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {VEHICLE_TYPES.map((t) => (
                  <div key={t}>
                    <label className="label" htmlFor={`price_${t}`}>
                      {VEHICLE_TYPE_LABELS[t]} (R$)
                    </label>
                    <input
                      id={`price_${t}`}
                      name={`price_${t}`}
                      inputMode="decimal"
                      className="input"
                      value={typePrices[t]}
                      onChange={(e) => setTypePrices((p) => ({ ...p, [t]: e.target.value }))}
                      placeholder="Padrão"
                      aria-invalid={errors[`price_${t}`] ? true : undefined}
                    />
                    {errors[`price_${t}`] ? (
                      <p className="error-text">{errors[`price_${t}`]}</p>
                    ) : (
                      typePrices[t].trim() === "" && <p className="hint-text">Usa o preço padrão ({formatCents(defaultCents)})</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              name="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-5 w-5 rounded border-line-strong text-brand focus:ring-brand"
            />
            Serviço ativo (visível para as clientes)
          </label>
        </fieldset>
      </form>

      {/* Fora do <form>: Enter no texto alternativo de uma foto não pode salvar o serviço por engano. */}
      <div className="border-t border-line pt-6">
        <ServicePhotos ref={photosRef} serviceId={serviceId} serviceName={name} photos={photos} storageConfigured={storageConfigured} />
      </div>

      {/* Separado das fotos (e dos botões de remover) por uma divisória: o clique em "Salvar" não cai em "Remover foto". */}
      <div className="border-t border-line pt-6">
        {created ? (
          <Link href="/admin/servicos" className="btn-primary w-full">
            Concluir
          </Link>
        ) : (
          <button type="submit" form="service-form" disabled={saving || uploading} className="btn-primary w-full">
            {saving ? "Salvando..." : "Salvar serviço"}
          </button>
        )}
      </div>
    </div>
  );
}
