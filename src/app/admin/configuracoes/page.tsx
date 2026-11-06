import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { loadSiteSettings } from "@/lib/site-settings";
import { SiteSettingsForm } from "@/components/SiteSettingsForm";

export default async function ConfiguracoesPage() {
  await requireAdmin();
  const [settings, logo] = await Promise.all([
    loadSiteSettings(),
    // Só os metadados: os bytes da imagem não saem do banco para montar esta tela.
    prisma.siteLogo.findUnique({ where: { id: 1 }, select: { contentType: true, width: true, height: true } }),
  ]);

  const kind = logo?.contentType.split("/")[1]?.toUpperCase().replace("JPEG", "JPEG");

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Estúdio</p>
        <h1 className="page-title mt-1">Configurações</h1>
        <p className="mt-1 text-sm text-plum-muted">
          Nome, logo e contatos que aparecem no site, no login, nas reservas e no Google Agenda.{" "}
          <Link href="/admin/configuracoes/google" className="link">
            Conexão com o Google Agenda
          </Link>
        </p>
      </div>
      <div className="max-w-2xl">
        <SiteSettingsForm
          initial={{
            siteName: settings.siteName,
            tagline: settings.tagline,
            intro: settings.intro,
            phone: settings.phone,
            whatsapp: settings.whatsapp,
            address: settings.address,
            locationNotes: settings.locationNotes,
            instagramUrl: settings.instagramUrl,
            logoUrl: settings.logoUrl,
            logoInfo: logo ? `${kind}, ${logo.width} × ${logo.height} px` : null,
          }}
        />
      </div>
    </div>
  );
}
