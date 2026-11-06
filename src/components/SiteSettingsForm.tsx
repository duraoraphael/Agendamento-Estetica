"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveSiteSettingsAction, type SettingsFormState } from "@/app/admin/configuracoes/actions";
import { LogoMark } from "@/components/ui";
import { LOGO_ALLOWED_TYPES, LOGO_GUIDANCE, LOGO_MAX_BYTES } from "@/lib/logo-image";
import { SETTINGS_LIMITS } from "@/lib/site-limits";

export interface SettingsFormValues {
  siteName: string;
  tagline: string;
  intro: string;
  phone: string;
  whatsapp: string;
  address: string;
  locationNotes: string;
  instagramUrl: string;
  logoUrl: string | null;
  logoInfo: string | null;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">
      {pending ? "Salvando..." : "Salvar configurações"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-erro`} className="error-text" role="alert">
      <span aria-hidden="true">⚠</span> {message}
    </p>
  );
}

export function SiteSettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [state, formAction] = useFormState<SettingsFormState, FormData>(saveSiteSettingsAction, null);
  const errors = state?.errors ?? {};

  const [name, setName] = useState(initial.siteName);
  const [tagline, setTagline] = useState(initial.tagline);
  const [intro, setIntro] = useState(initial.intro);
  // Controlados: ao terminar uma ação o React reinicia campos não controlados para o valor inicial, e um salvamento
  // com erro (ex.: logo recusada) apagaria o que a administradora acabou de digitar.
  const [phone, setPhone] = useState(initial.phone);
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp);
  const [instagramUrl, setInstagramUrl] = useState(initial.instagramUrl);
  const [address, setAddress] = useState(initial.address);
  const [locationNotes, setLocationNotes] = useState(initial.locationNotes);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  // A prévia da imagem escolhida vive só no navegador (blob:); nada é enviado antes de "Salvar".
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // Depois de salvar com sucesso, a prévia local passa a ser a logo oficial (a página recarrega os dados).
  useEffect(() => {
    if (state?.ok) {
      setPreview(null);
      setRemoveLogo(false);
    }
  }, [state]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileProblem(null);
    setPreview(null);
    if (!file) return;
    if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      setFileProblem("Formato não aceito. Use PNG, JPEG ou WebP.");
      e.target.value = "";
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFileProblem(`Arquivo grande demais (${Math.ceil(file.size / 1024)} KB). O máximo é ${LOGO_MAX_BYTES / 1024} KB.`);
      e.target.value = "";
      return;
    }
    setRemoveLogo(false);
    setPreview(URL.createObjectURL(file));
  }

  const shownLogo = removeLogo ? null : preview ?? initial.logoUrl;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state && (
        <div className={state.ok ? "notice-success" : "notice-error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </div>
      )}

      <section className="card space-y-5" aria-labelledby="identidade">
        <h2 id="identidade" className="font-display text-xl font-semibold text-plum">
          Identidade
        </h2>

        {/* Prévia do cabeçalho e da abertura, atualizada enquanto se digita */}
        <div aria-label="Prévia da identidade visual" className="rounded-2xl border border-blush-deep/60 bg-cream p-4">
          <p className="eyebrow mb-3">Prévia</p>
          <div className="flex items-center gap-2.5 rounded-full border border-neutral-line bg-white px-3 py-2">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) ou logo própria
              <img src={shownLogo} alt="" className="h-9 w-9 flex-none rounded-full object-cover" />
            ) : (
              <LogoMark className="h-9 w-9 flex-none" />
            )}
            <span className="font-display text-lg font-semibold leading-none text-plum">{name || "Nome do estúdio"}</span>
          </div>
          <p className="eyebrow mt-4">{tagline || "Slogan do estúdio"}</p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-plum-muted">{intro || "Texto de apresentação"}</p>
        </div>

        <div>
          <label className="label" htmlFor="siteName">Nome do site ou estúdio</label>
          <input id="siteName" name="siteName" required maxLength={SETTINGS_LIMITS.siteNameMax} className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.siteName ? true : undefined} aria-describedby={errors.siteName ? "siteName-erro" : undefined} />
          <FieldError id="siteName" message={errors.siteName} />
        </div>

        <div>
          <label className="label" htmlFor="tagline">Slogan</label>
          <input id="tagline" name="tagline" maxLength={SETTINGS_LIMITS.taglineMax} className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} aria-describedby="tagline-dica" />
          <p id="tagline-dica" className="hint-text">Frase curta acima do título na página inicial. Em branco usa o texto padrão.</p>
          <FieldError id="tagline" message={errors.tagline} />
        </div>

        <div>
          <label className="label" htmlFor="intro">Texto curto de apresentação</label>
          <textarea id="intro" name="intro" rows={3} maxLength={SETTINGS_LIMITS.introMax} className="input" value={intro} onChange={(e) => setIntro(e.target.value)} aria-describedby="intro-dica" />
          <p id="intro-dica" className="hint-text">Até {SETTINGS_LIMITS.introMax} caracteres ({intro.length}/{SETTINGS_LIMITS.introMax}). Aparece na página inicial.</p>
          <FieldError id="intro" message={errors.intro} />
        </div>

        <div>
          <label className="label" htmlFor="logo">Logo</label>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-full border border-gold/50 bg-white">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) ou logo própria
                <img src={shownLogo} alt="Logo atual" className="h-full w-full object-cover" />
              ) : (
                <LogoMark className="h-16 w-16" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="block w-full text-sm text-plum file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-full file:border file:border-wine/40 file:bg-white file:px-4 file:font-semibold file:text-wine" aria-describedby="logo-dica logo-erro" />
              {initial.logoInfo && !preview && <p className="mt-1 text-xs text-plum-muted">Logo atual: {initial.logoInfo}. Escolha um novo arquivo para substituir.</p>}
              {preview && <p className="mt-1 text-xs text-plum-muted">Nova logo selecionada — ela só vale depois de salvar.</p>}
            </div>
          </div>
          <p id="logo-dica" className="hint-text">{LOGO_GUIDANCE}</p>
          {(fileProblem || errors.logo) && <FieldError id="logo" message={fileProblem ?? errors.logo} />}
          {initial.logoUrl && (
            <label className="mt-3 flex items-center gap-2 text-sm text-plum-muted">
              <input type="checkbox" name="removeLogo" checked={removeLogo} onChange={(e) => { setRemoveLogo(e.target.checked); if (e.target.checked) setPreview(null); }} className="h-5 w-5 rounded border-plum-line text-wine focus:ring-wine" />
              Remover a logo e voltar à marca padrão
            </label>
          )}
        </div>
      </section>

      <section className="card space-y-5" aria-labelledby="contatos">
        <h2 id="contatos" className="font-display text-xl font-semibold text-plum">
          Contatos e localização
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="phone">Telefone</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={SETTINGS_LIMITS.phoneMax} value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="(11) 3000-0000" />
            <FieldError id="phone" message={errors.phone} />
          </div>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" autoComplete="off" maxLength={SETTINGS_LIMITS.phoneMax} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="input" placeholder="(11) 90000-0000" />
            <FieldError id="whatsapp" message={errors.whatsapp} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="instagramUrl">Instagram</label>
          <input id="instagramUrl" name="instagramUrl" autoComplete="off" maxLength={200} value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className="input" placeholder="@seuestudio ou instagram.com/seuestudio" />
          <FieldError id="instagramUrl" message={errors.instagramUrl} />
        </div>
        <div>
          <label className="label" htmlFor="address">Endereço</label>
          <input id="address" name="address" maxLength={SETTINGS_LIMITS.addressMax} value={address} onChange={(e) => setAddress(e.target.value)} className="input" placeholder="Rua das Flores, 123 — Centro, São Paulo/SP" aria-describedby="address-dica" />
          <p id="address-dica" className="hint-text">Vai no evento do Google Agenda da cliente e da administradora.</p>
          <FieldError id="address" message={errors.address} />
        </div>
        <div>
          <label className="label" htmlFor="locationNotes">Instruções de localização</label>
          <textarea id="locationNotes" name="locationNotes" rows={3} maxLength={SETTINGS_LIMITS.locationNotesMax} value={locationNotes} onChange={(e) => setLocationNotes(e.target.value)} className="input" placeholder="Ex.: sala 12, 2º andar; interfone 12; estacionamento na rua lateral." />
          <FieldError id="locationNotes" message={errors.locationNotes} />
        </div>
      </section>

      <SaveButton />
    </form>
  );
}
