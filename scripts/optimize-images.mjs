// Converte as fotos geradas para os arquivos finais do site (WebP, proporção exata, sem metadados).
//   npm run images:optimize -- <pasta-de-origem>
// Veja docs/imagens.md. O `sharp` já vem instalado junto com o Next.js (otimizador de imagens).
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import sharp from "sharp";

const TARGETS = {
  "hero-carro": [1983, 793],
  "lavagem-detalhada": [1200, 800],
  "higienizacao-interna": [1200, 800],
  polimento: [1200, 800],
  "carro-molhado": [1000, 1400],
  "detalhe-rodas": [1200, 800],
  "detalhe-pintura": [1200, 800],
  "detalhe-interior": [1200, 800],
};
const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const source = process.argv[2];
if (!source || !existsSync(source)) {
  console.error("Uso: npm run images:optimize -- <pasta-de-origem>\nA pasta precisa existir e conter arquivos com os nomes de docs/imagens.md.");
  process.exit(1);
}

const outDir = resolve("public", "images");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(source).filter((f) => EXTENSIONS.has(parse(f).ext.toLowerCase()));
let done = 0;
for (const [name, [width, height]] of Object.entries(TARGETS)) {
  const file = files.find((f) => parse(f).name === name);
  if (!file) {
    console.log(`- ${name}: não encontrada na pasta (mantendo a atual)`);
    continue;
  }
  // Recorte centralizado na região de maior interesse; WebP sem metadados (o sharp não copia EXIF/GPS por padrão).
  await sharp(join(source, file)).rotate().resize(width, height, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toFile(join(outDir, `${name}.webp`));
  console.log(`✓ ${name}.webp (${width}×${height})`);
  done++;
}
console.log(done === 0 ? "Nenhuma imagem convertida." : `Pronto: ${done} imagem(ns) em public/images/.`);
