# Imagens da Garage Zero Zero

O site já está pronto para fotografias reais. Hoje `public/images/` tem **8 fotos otimizadas**, nos nomes e tamanhos
finais. Para trocar uma foto, basta sobrescrever o arquivo
**com o mesmo nome**: nenhum código muda (`src/lib/site.ts`, constante `PHOTOS`, guarda largura, altura e texto alternativo).

## Como trocar (o caminho curto)

1. Gere as 8 imagens (prompts abaixo) e salve-as numa pasta, com estes nomes de arquivo (a extensão pode ser PNG, JPG ou WebP):
   `hero-carro`, `lavagem-detalhada`, `higienizacao-interna`, `polimento-tecnico`, `cristalizacao-de-pintura`, `vitrificacao`, `higienizacao-de-ar-condicionado`, `limpeza-e-hidratacao-de-couro`.
2. Rode o otimizador, apontando para essa pasta:

   ```bash
   npm run images:optimize -- C:/caminho/da/pasta
   ```

   Ele recorta cada imagem na proporção exata, converte para **WebP (qualidade 80)**, **remove os metadados** (EXIF/GPS) e grava
   em `public/images/`. Imagens que faltarem na pasta são ignoradas (o placeholder atual continua).
3. Rode `npm run dev` e confira. O `next/image` já serve versões responsivas (`sizes`) e as dimensões fixas evitam salto de layout.

## As 8 imagens

| Arquivo | Tamanho (px) | Proporção | Onde aparece |
|---|---|---|---|
| `hero-carro.webp` | 1983 × 793 | ≈ 2,5:1 (panorâmica) | Fundo da abertura da página inicial, lado da foto em Entrar, Criar conta e Recuperar/Redefinir senha, e "Agendamento confirmado". Carro à direita e espaço escuro à esquerda (o título fica ali) |
| `lavagem-detalhada.webp` | 1000 × 800 | 5:4 | Cartão do serviço, `/servicos`, "Meus agendamentos" |
| `higienizacao-interna.webp` | 1000 × 800 | 5:4 | Higienização interna |
| `polimento-tecnico.webp` | 1000 × 800 | 5:4 | Polimento técnico |
| `cristalizacao-de-pintura.webp` | 1000 × 800 | 5:4 | Cristalização e imagem padrão de pintura |
| `vitrificacao.webp` | 1000 × 800 | 5:4 | Vitrificação |
| `higienizacao-de-ar-condicionado.webp` | 1000 × 800 | 5:4 | Higienização de ar-condicionado |
| `limpeza-e-hidratacao-de-couro.webp` | 1000 × 800 | 5:4 | Limpeza e hidratação de couro e imagem padrão de interior |

Deixe o assunto principal **no terço direito** ou no centro: nas telas de login o lado esquerdo é coberto por um degradê escuro.

## Regras para todas as imagens

- Iluminação **escura**, com detalhes **amarelos quentes** (barras de luz, reflexos).
- **Sem texto, sem logos, sem marcas de montadoras, sem placas legíveis, sem rostos.** Mãos com luvas pretas são bem-vindas.
- Não copie as telas de referência (interface, textos) para dentro da imagem.
- Foto real ou gerada **de sua propriedade**; guarde a origem.
- Os textos alternativos (`alt`) estão em `src/lib/site.ts`: ajuste-os se a foto final for muito diferente do descrito.

## Prompts sugeridos (para o gerador de imagens que você já usa)

Use estes textos como ponto de partida, adicionando ao final: *"fotografia realista, sem texto, sem logotipos, sem marcas, alta resolução"*.

1. **hero-carro** — Carro esportivo preto, molhado de lavagem, em uma garagem escura e premium; luzes de LED amarelas quentes ao fundo, piso molhado refletindo a luz, gotas na pintura, composição ampla 16:9 com o carro à direita e espaço escuro à esquerda.
2. **lavagem-detalhada** — Mão com luva preta lavando o farol de um carro preto com uma esponja de microfibra amarela e muita espuma branca; iluminação escura com reflexos amarelos; plano fechado 3:2.
3. **higienizacao-interna** — Banco de carro em tecido escuro sendo higienizado com extratora (bico transparente), mão com luva preta; ambiente escuro com luz amarela lateral; plano fechado 5:4.
4. **polimento-tecnico** — Politriz orbital com boina amarela polindo o capô preto de um carro, mão com luva preta segurando o equipamento; reflexos nítidos na pintura; fundo escuro com brilho amarelo quente; 5:4.
5. **cristalizacao-de-pintura** — Reflexo de luz amarela na pintura preta recém-cristalizada, gotas perfeitas de água e profundidade de campo rasa; 5:4.
6. **vitrificacao** — Pintura preta com brilho espelhado e proteção cerâmica, iluminação premium amarela; 5:4.
7. **higienizacao-de-ar-condicionado** — Limpeza profissional das saídas de ar do interior automotivo, mão com luva preta; 5:4.
8. **limpeza-e-hidratacao-de-couro** — Interior de couro preto sendo limpo e hidratado, com costuras amarelas e iluminação quente; 5:4.

> Se um dia você quiser gerar as imagens por uma API (custo por sua conta) ou permitir **upload de fotos dos veículos pelos
> clientes**, isso exige decisões extras (tamanho, tipo, armazenamento, remoção de metadados e privacidade) e está
> **fora do escopo atual**.
