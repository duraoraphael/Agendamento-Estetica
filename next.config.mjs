const isProd = process.env.NODE_ENV === "production";
// HSTS e upgrade-insecure-requests só quando o site público é servido por HTTPS
// (NEXTAUTH_URL=https://...). Em `next start` local por HTTP eles quebrariam a página.
const isHttps = isProd && (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

// Content-Security-Policy.
// O Next.js injeta scripts inline de inicialização, então `script-src` precisa
// de 'unsafe-inline' enquanto não houver CSP com nonce (veja "Riscos residuais" no README).
// O restante da política (frames, formulários, objetos, base-uri, origens de
// imagem/fonte/conexão) é restritivo. 'unsafe-eval' só em desenvolvimento (React Refresh).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // accounts.google.com: o fluxo OAuth redireciona para lá a partir de /api/google/connect.
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Isolam a janela do site de outras origens (o login do Google é uma navegação normal, sem pop-up).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // HSTS só em produção com HTTPS.
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// Fotos dos serviços: ficam no Supabase Storage (bucket público `service-images`). O `next/image` só otimiza imagens
// de origens autorizadas: aqui entra SOMENTE o host exato do projeto (SUPABASE_URL) e SOMENTE o caminho público desse
// bucket. Sem curingas de domínio. O navegador nunca fala com o Supabase: ele pede `/_next/image?url=...` ao próprio
// site (por isso o `img-src 'self'` do CSP continua suficiente) e o servidor busca a foto.
function serviceImageRemotePatterns() {
  try {
    const url = new URL(process.env.SUPABASE_URL ?? "");
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return [];
    return [
      {
        protocol: url.protocol.replace(":", ""),
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        pathname: "/storage/v1/object/public/service-images/**",
      },
    ];
  } catch {
    return []; // Storage ainda não configurado: o site usa os placeholders.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: serviceImageRemotePatterns(),
    // Os caminhos são aleatórios e imutáveis: o otimizador pode guardar a versão processada por 1 ano.
    minimumCacheTTL: 31536000,
  },
  // Remove o cabeçalho X-Powered-By.
  poweredByHeader: false,
  // Permite rodar um servidor de teste isolado (NEXT_DIST_DIR=.next-audit) sem
  // sobrescrever a pasta de build do servidor principal: dois `next dev` na mesma
  // pasta .next corrompem o manifesto de rotas (causa dos 404 em /meus-agendamentos).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
