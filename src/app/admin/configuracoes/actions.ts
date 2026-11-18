"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { formatZodError } from "@/lib/validation";
import { LOGO_MAX_BYTES, LogoValidationError } from "@/lib/logo-image";
import { saveSiteSettings, siteSettingsSchema, validateLogo, type LogoChange } from "@/lib/site-settings";
import { invalidateSiteSettings } from "@/lib/site-settings-cache";
import { recordAudit } from "@/lib/audit-log";

export type SettingsFormState = { ok: boolean; message: string; errors?: Record<string, string> } | null;

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * Salva identidade e contatos da empresa (e, se enviada, a logo). Só a administradora:
 * `requireAdmin` confere a sessão E o papel no banco a cada chamada — uma Server Action é um endpoint
 * público, então a tela escondida não protege nada. Tudo é validado de novo aqui; a logo é inspecionada
 * pelos bytes (formato, tamanho, dimensões), nunca pelo que o navegador declara.
 */
export async function saveSiteSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const admin = await requireAdmin();

  const limit = await hitLimit(limitKey("settings-admin", admin.id), RATE_LIMITS.settingsPerMinute, 60_000);
  if (limit.blocked) {
    securityLog("settings_rate_limited", { userId: admin.id });
    return { ok: false, message: "Muitas alterações seguidas. Aguarde um instante e tente de novo." };
  }

  const parsed = siteSettingsSchema.safeParse({
    siteName: text(formData, "siteName"),
    tagline: text(formData, "tagline"),
    intro: text(formData, "intro"),
    phone: text(formData, "phone"),
    whatsapp: text(formData, "whatsapp"),
    address: text(formData, "address"),
    locationNotes: text(formData, "locationNotes"),
    instagramUrl: text(formData, "instagramUrl"),
  });
  const errors: Record<string, string> = parsed.success ? {} : formatZodError(parsed.error);

  let logo: LogoChange = { kind: "keep" };
  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES) {
      errors.logo = `A logo é grande demais (${Math.ceil(file.size / 1024)} KB). O máximo é ${LOGO_MAX_BYTES / 1024} KB.`;
    } else {
      try {
        logo = { kind: "replace", logo: validateLogo(new Uint8Array(await file.arrayBuffer()), file.type || undefined) };
      } catch (err) {
        if (!(err instanceof LogoValidationError)) throw err;
        securityLog("logo_rejected", { userId: admin.id });
        errors.logo = err.message;
      }
    }
  } else if (formData.get("removeLogo") === "on") {
    logo = { kind: "remove" };
  }

  if (!parsed.success || Object.keys(errors).length > 0) {
    return { ok: false, message: "Não foi possível salvar. Corrija os campos destacados.", errors };
  }

  try {
    await saveSiteSettings(parsed.data, logo);
  } catch (err) {
    console.error("Erro ao salvar configurações:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Não foi possível salvar agora. Tente novamente em instantes." };
  }

  securityLog("settings_changed", { adminId: admin.id, logo: logo.kind });
  // Só o que mudou em termos gerais: os textos digitados (telefone, endereço...) não vão para o log.
  await recordAudit({
    action: "settings_changed",
    actorId: admin.id,
    targetType: "SiteSettings",
    targetId: "1",
    detail: logo.kind === "replace" ? "Dados da empresa e logo trocada" : logo.kind === "remove" ? "Dados da empresa e logo removida" : "Dados da empresa",
  });
  // Invalida o cache global das configurações e as telas que mostram a identidade.
  invalidateSiteSettings();
  revalidatePath("/", "layout");
  return { ok: true, message: "Configurações salvas. O site já usa os novos dados." };
}
