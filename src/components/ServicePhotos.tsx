"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ServiceImageView } from "@/components/ServiceImageView";
import { PHOTOS } from "@/lib/site";
import {
  removeServiceImageAction,
  reorderServiceImagesAction,
  updateServiceImageAltAction,
} from "@/app/admin/servicos/fotos-actions";
import { precheckFile, uploadServiceImage } from "@/lib/service-image-upload";
import { SERVICE_IMAGE_ALT_MAX, SERVICE_IMAGE_GUIDANCE, SERVICE_IMAGE_INPUT_TYPES, SERVICE_IMAGE_MAX_PER_SERVICE } from "@/lib/service-image-config";

export interface AdminPhoto {
  id: string;
  url: string;
  alt: string;
  altText: string;
  width: number;
  height: number;
}

interface PendingItem {
  key: number;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "error";
  progress: number;
  error?: string;
}

export interface UploadReport {
  sent: number;
  failed: { name: string; error: string }[];
}

export interface ServicePhotosHandle {
  /** Envia as fotos escolhidas (serviço recém-criado). Devolve quantas subiram e quais falharam, com o motivo. */
  uploadPending(serviceId: string): Promise<UploadReport>;
  pendingCount(): number;
}

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

const ACCEPT = SERVICE_IMAGE_INPUT_TYPES.join(",");
const TILE = "overflow-hidden rounded-xl border border-brand/40 bg-surface-2";
const SMALL_BTN =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-line-strong px-2 text-sm font-semibold text-fg transition hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BTN =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-status-danger/60 px-2 text-sm font-semibold text-status-danger transition hover:bg-status-danger-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-status-danger disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "Fotos do serviço": até 6, a primeira é a capa. Com `serviceId`, cada foto escolhida é enviada na hora (uma por vez,
 * com progresso). Sem `serviceId` (serviço novo), as fotos ficam na fila com prévia e sobem depois que o serviço é
 * salvo (`uploadPending`). Tudo o que importa é conferido de novo no servidor; esta tela só dá resposta rápida.
 */
export const ServicePhotos = forwardRef<
  ServicePhotosHandle,
  { serviceId: string | null; serviceName: string; photos: AdminPhoto[]; storageConfigured?: boolean; onPendingChange?: (count: number) => void }
>(function ServicePhotos({ serviceId, serviceName, photos, storageConfigured = true, onPendingChange }, ref) {
  const router = useRouter();
  const [saved, setSaved] = useState<AdminPhoto[]>(photos);
  const [pending, setPendingState] = useState<PendingItem[]>([]);
  const pendingRef = useRef<PendingItem[]>([]);
  const keyRef = useRef(0);
  const queueRef = useRef<Promise<UploadReport> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Arquivos recusados na escolha (formato, tamanho, limite). Fica à parte do `notice`, que o envio sobrescreve.
  const [rejections, setRejections] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [altOpenId, setAltOpenId] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState("");

  // Quando o servidor reenvia a lista (depois de router.refresh), a tela acompanha.
  useEffect(() => {
    setSaved(photos);
  }, [photos]);

  const setPending = useCallback(
    (update: (items: PendingItem[]) => PendingItem[]) => {
      pendingRef.current = update(pendingRef.current);
      setPendingState(pendingRef.current);
      onPendingChange?.(pendingRef.current.length);
    },
    [onPendingChange],
  );

  // Libera as prévias (blob:) ao sair da tela.
  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const occupied = saved.length + pending.filter((p) => p.status !== "error").length;
  // Sem Storage configurado nada cabe: o aviso explica e o botão fica desabilitado (o servidor também recusa, com 503).
  const free = storageConfigured ? Math.max(0, SERVICE_IMAGE_MAX_PER_SERVICE - occupied) : 0;

  /** Envia a fila, uma foto por vez. Só uma execução por vez (envio simultâneo vira a mesma fila). */
  const processQueue = useCallback(
    (id: string): Promise<UploadReport> => {
      if (queueRef.current) return queueRef.current;
      const run = (async (): Promise<UploadReport> => {
        let sent = 0;
        const failed: UploadReport["failed"] = [];
        for (;;) {
          const next = pendingRef.current.find((i) => i.status === "queued");
          if (!next) break;
          setPending((items) => items.map((i) => (i.key === next.key ? { ...i, status: "uploading", progress: 0, error: undefined } : i)));
          const result = await uploadServiceImage(id, next.file, (fraction) =>
            setPending((items) => items.map((i) => (i.key === next.key ? { ...i, progress: fraction } : i))),
          );
          if (result.ok) {
            URL.revokeObjectURL(next.previewUrl);
            setPending((items) => items.filter((i) => i.key !== next.key));
            sent++;
          } else {
            setPending((items) => items.map((i) => (i.key === next.key ? { ...i, status: "error", error: result.error } : i)));
            failed.push({ name: next.file.name, error: result.error });
          }
        }
        return { sent, failed };
      })().finally(() => {
        queueRef.current = null;
      });
      queueRef.current = run;
      return run;
    },
    [setPending],
  );

  function reportToNotice(report: UploadReport): Notice {
    if (report.failed.length === 0) {
      return { tone: "success", text: report.sent === 1 ? "Foto enviada com sucesso." : `${report.sent} fotos enviadas com sucesso.` };
    }
    const names = report.failed.map((f) => `${f.name} (${f.error})`).join("; ");
    return {
      tone: "error",
      text: `${report.sent > 0 ? `${report.sent} enviada(s). ` : ""}Não foi possível enviar ${report.failed.length} foto(s): ${names}`,
    };
  }

  async function sendQueue(id: string) {
    setNotice({ tone: "info", text: "Enviando fotos…" });
    const report = await processQueue(id);
    setNotice(reportToNotice(report));
    if (report.sent > 0) router.refresh();
  }

  useImperativeHandle(
    ref,
    () => ({
      async uploadPending(id: string) {
        const report = await processQueue(id);
        setNotice(reportToNotice(report));
        return report;
      },
      pendingCount: () => pendingRef.current.length,
    }),
    [processQueue],
  );

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    let room = free;
    for (const file of files) {
      const problem = precheckFile(file);
      if (problem) {
        rejected.push(`${file.name}: ${problem}`);
      } else if (room <= 0) {
        rejected.push(`${file.name}: limite de ${SERVICE_IMAGE_MAX_PER_SERVICE} fotos atingido.`);
      } else {
        accepted.push(file);
        room--;
      }
    }
    if (accepted.length > 0) {
      setPending((items) => [
        ...items,
        ...accepted.map((file): PendingItem => ({ key: ++keyRef.current, file, previewUrl: URL.createObjectURL(file), status: "queued", progress: 0 })),
      ]);
    }
    setRejections(rejected);
    if (rejected.length === 0) setNotice(null);
    if (accepted.length > 0 && serviceId) {
      // Serviço já existe: envia agora. (O estado ainda não refletiu os novos itens, então espera o próximo ciclo.)
      queueMicrotask(() => void sendQueue(serviceId));
    }
  }

  function removePending(key: number) {
    const item = pendingRef.current.find((i) => i.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setPending((items) => items.filter((i) => i.key !== key));
  }

  function makePendingCover(key: number) {
    setPending((items) => {
      const target = items.find((i) => i.key === key);
      return target ? [target, ...items.filter((i) => i.key !== key)] : items;
    });
  }

  function retry(key: number) {
    setPending((items) => items.map((i) => (i.key === key ? { ...i, status: "queued", error: undefined, progress: 0 } : i)));
    if (serviceId) queueMicrotask(() => void sendQueue(serviceId));
  }

  async function reorder(next: AdminPhoto[], success: string) {
    if (!serviceId) return;
    const previous = saved;
    setSaved(next); // resposta imediata; volta atrás se o servidor recusar
    setBusy(true);
    const result = await reorderServiceImagesAction(serviceId, next.map((p) => p.id));
    setBusy(false);
    if (!result.ok) {
      setSaved(previous);
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setNotice({ tone: "success", text: success });
    router.refresh();
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= saved.length) return;
    const next = [...saved];
    [next[index], next[target]] = [next[target], next[index]];
    void reorder(next, target === 0 || index === 0 ? "Ordem atualizada. A capa foi trocada." : "Ordem atualizada.");
  }

  function makeCover(id: string) {
    const photo = saved.find((p) => p.id === id);
    if (!photo) return;
    void reorder([photo, ...saved.filter((p) => p.id !== id)], "Capa atualizada.");
  }

  async function confirmRemove(id: string) {
    if (!serviceId) return;
    const wasCover = saved[0]?.id === id;
    setBusy(true);
    const result = await removeServiceImageAction(serviceId, id);
    setBusy(false);
    setConfirmingId(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setSaved((list) => list.filter((p) => p.id !== id));
    setNotice({ tone: "success", text: wasCover && saved.length > 1 ? "Capa removida. A próxima foto agora é a capa." : "Foto removida." });
    router.refresh();
  }

  async function saveAlt(id: string) {
    if (!serviceId) return;
    setBusy(true);
    const result = await updateServiceImageAltAction(serviceId, id, altDraft);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setSaved((list) => list.map((p) => (p.id === id ? { ...p, altText: altDraft.trim(), alt: altDraft.trim() || p.alt } : p)));
    setAltOpenId(null);
    setNotice({ tone: "success", text: "Texto alternativo salvo." });
    router.refresh();
  }

  const total = saved.length + pending.length;
  const noticeClass =
    notice?.tone === "success" ? "notice-success" : notice?.tone === "error" ? "notice-error" : "notice border-line-strong bg-surface-2 text-fg";

  return (
    <section aria-labelledby="fotos-servico" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="fotos-servico" className="text-2xl text-fg">Fotos do serviço</h3>
          <p className="hint-text mt-0.5">A primeira foto é a capa; as demais formam a galeria. {serviceId ? "As alterações são salvas na hora." : "As fotos sobem depois que você salvar o serviço."}</p>
        </div>
        <p className="badge bg-brand/15 text-brand" aria-live="polite">
          {total} de {SERVICE_IMAGE_MAX_PER_SERVICE} fotos
        </p>
      </div>

      {!storageConfigured && (
        <div className="notice-warning" role="status">
          O armazenamento de fotos ainda não foi configurado no servidor (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY). Até lá, o site usa as imagens padrão. Veja docs/fotos-servicos.md.
        </div>
      )}

      {/* Área de arrastar e soltar. O botão funciona só com teclado; o arrastar é um extra. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition ${dragging ? "border-brand bg-brand/10" : "border-brand/40 bg-surface-2"}`}
      >
        <p className="text-sm text-fg-muted">Arraste as fotos para cá ou</p>
        <button
          type="button"
          className="btn-secondary mt-2"
          disabled={free === 0}
          onClick={() => inputRef.current?.click()}
        >
          Adicionar fotos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Escolher fotos do serviço"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = ""; // permite escolher o mesmo arquivo de novo
          }}
        />
        <p className="hint-text mt-2">{!storageConfigured ? SERVICE_IMAGE_GUIDANCE : free === 0 ? `Limite de ${SERVICE_IMAGE_MAX_PER_SERVICE} fotos atingido. Remova uma para adicionar outra.` : SERVICE_IMAGE_GUIDANCE}</p>
      </div>

      {rejections.length > 0 && (
        <div className="notice-error" role="alert">
          <div>
            <p className="font-semibold">Não foi possível adicionar:</p>
            <ul className="mt-1 list-disc pl-5">
              {rejections.map((r, i) => (
                <li key={`${r}-${i}`}>{r}</li>
              ))}
            </ul>
            <button type="button" className="link mt-2 min-h-[44px]" onClick={() => setRejections([])}>
              Dispensar aviso
            </button>
          </div>
        </div>
      )}

      <div aria-live="polite">{notice &&<div className={noticeClass} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}</div>

      {total === 0 ? (
        <div className="rounded-xl border border-line bg-surface-2 p-5 text-center text-sm text-fg-muted">
          Este serviço ainda não tem fotos. Enquanto isso, o site mostra uma imagem padrão da Garage Zero Zero.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {saved.map((photo, index) => (
            <li key={photo.id} className={TILE} data-testid="foto-salva">
              <div className="relative">
                <ServiceImageView
                  photo={photo}
                  fallback={PHOTOS.pintura}
                  sizes="(min-width: 640px) 200px, 45vw"
                  className="aspect-[4/3] w-full object-cover"
                />
                {index === 0 && <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-xs font-extrabold uppercase text-ink">Capa</span>}
              </div>

              <div className="space-y-2 p-2">
                {confirmingId === photo.id ? (
                  <div role="alertdialog" aria-label="Confirmar remoção da foto" className="space-y-2">
                    <p className="text-sm font-semibold text-fg">Remover esta foto?{index === 0 && saved.length > 1 ? " A próxima será a capa." : ""}</p>
                    <button type="button" className="btn-danger w-full" disabled={busy} onClick={() => void confirmRemove(photo.id)}>
                      Sim, remover
                    </button>
                    <button type="button" className={SMALL_BTN} disabled={busy} onClick={() => setConfirmingId(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={SMALL_BTN} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Mover a foto ${index + 1} para antes`}>
                        ◀ Antes
                      </button>
                      <button type="button" className={SMALL_BTN} disabled={busy || index === saved.length - 1} onClick={() => move(index, 1)} aria-label={`Mover a foto ${index + 1} para depois`}>
                        Depois ▶
                      </button>
                    </div>
                    {index > 0 && (
                      <button type="button" className={SMALL_BTN} disabled={busy} onClick={() => makeCover(photo.id)}>
                        Definir como capa
                      </button>
                    )}
                    {altOpenId === photo.id ? (
                      <div className="space-y-2">
                        <label className="label" htmlFor={`alt-${photo.id}`}>Texto alternativo</label>
                        <input
                          id={`alt-${photo.id}`}
                          className="input"
                          value={altDraft}
                          maxLength={SERVICE_IMAGE_ALT_MAX}
                          placeholder={photo.alt}
                          onChange={(e) => setAltDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveAlt(photo.id);
                            }
                          }}
                        />
                        <p className="hint-text">Descreva a cena. Vazio usa “{serviceName.trim() || "Serviço"} — Garage Zero Zero”.</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" className="btn-primary px-2" disabled={busy} onClick={() => void saveAlt(photo.id)}>Salvar</button>
                          <button type="button" className={SMALL_BTN} disabled={busy} onClick={() => setAltOpenId(null)}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={busy}
                        onClick={() => {
                          setAltOpenId(photo.id);
                          setAltDraft(photo.altText);
                        }}
                      >
                        Texto alternativo
                      </button>
                    )}
                    {/* Longe do botão principal "Salvar serviço" (que fica abaixo de toda a seção, separado por divisória). */}
                    <button type="button" className={DANGER_BTN} disabled={busy} onClick={() => setConfirmingId(photo.id)}>
                      Remover foto
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}

          {pending.map((item, index) => (
            <li key={item.key} className={TILE} data-testid="foto-pendente">
              <div className="relative">
                {/* Prévia local (blob:) antes do envio: o otimizador do next/image não alcança blobs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt="Prévia da foto escolhida" className="aspect-[4/3] w-full object-cover" />
                {saved.length === 0 && index === 0 && item.status !== "error" && (
                  <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-xs font-extrabold uppercase text-ink">Capa</span>
                )}
              </div>
              <div className="space-y-2 p-2">
                {item.status === "uploading" ? (
                  <div>
                    <p className="text-sm font-semibold text-fg">Enviando… {Math.round(item.progress * 100)}%</p>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} aria-label="Progresso do envio">
                      <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  </div>
                ) : item.status === "error" ? (
                  <>
                    <p className="error-text" role="alert">{item.error}</p>
                    {serviceId && <button type="button" className={SMALL_BTN} onClick={() => retry(item.key)}>Tentar novamente</button>}
                    <button type="button" className={DANGER_BTN} onClick={() => removePending(item.key)}>Descartar</button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-fg-muted">{serviceId ? "Na fila para envio…" : "Será enviada ao salvar o serviço."}</p>
                    {!serviceId && saved.length === 0 && index > 0 && (
                      <button type="button" className={SMALL_BTN} onClick={() => makePendingCover(item.key)}>Definir como capa</button>
                    )}
                    <button type="button" className={DANGER_BTN} onClick={() => removePending(item.key)}>Remover foto</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
