# Fotos dos serviços

Cada serviço pode ter até **6 fotos**. A primeira é a **capa**; as demais formam a **galeria**. A administradora envia, reordena, troca a capa, edita o texto alternativo e remove as fotos em **Admin → Serviços → Editar** (e na criação de um serviço novo). Sem foto, o site mostra o placeholder da Garage Zero Zero (as imagens fixas em `public/images`, veja [imagens.md](imagens.md)).

## Como funciona

| Parte | Onde fica |
|---|---|
| Arquivos (WebP) | Supabase Storage, bucket **público** `service-images`, caminho `services/{serviceId}/{uuid}.webp` |
| Metadados (posição, texto alternativo, dimensões, tamanho) | PostgreSQL, tabela `ServiceImage` (a menor `position` é a capa) |
| Remoções que o Storage recusou | tabela `StorageCleanup` + `npm run storage:cleanup` |

- **Quem escreve:** só o servidor, depois do NextAuth (papel `ADMIN` conferido no banco a cada chamada). O navegador **nunca** recebe a chave do Supabase e não fala com o Storage para escrever. Não existe política de `INSERT`/`UPDATE`/`DELETE` em `storage.objects`.
- **Quem lê:** qualquer pessoa, só leitura (é conteúdo de marketing). O site serve as fotos por `next/image` (`/_next/image`), então o navegador também não precisa falar com o Supabase.
- **Envio:** uma foto por requisição, `POST /api/admin/servicos/{id}/fotos`, corpo = bytes da imagem. Reordenar, remover e editar o texto alternativo são Server Actions (`src/app/admin/servicos/fotos-actions.ts`).
- **Processamento no servidor** (`src/lib/image-processing.ts`): confere o tamanho (até 8 MB), o formato pelos **magic bytes** (JPEG, PNG ou WebP; SVG, GIF e qualquer outra coisa são recusados), decodifica de verdade com o `sharp` (arquivo corrompido, animado ou com pixels demais é recusado), corrige a orientação, reduz para caber em **1600 × 1200** sem ampliar, converte para **WebP (qualidade 82)** e **remove EXIF, GPS e demais metadados**. Largura, altura e tamanho gravados são os do resultado.
- **Teto de 6 fotos** vale mesmo com envios simultâneos: toda mudança trava a linha do serviço (`SELECT … FOR UPDATE`) dentro da transação.
- **Sem órfãos:** o arquivo vai ao Storage antes; se o banco falhar, ele é apagado. Na remoção, o metadado sai primeiro (a vitrine para de apontar para a foto) e depois o arquivo é apagado; se o Storage falhar, o caminho vai para `StorageCleanup` e aparece no log de auditoria como "Arquivo de foto aguardando limpeza".
- **Auditoria** (`/admin/logs`, categoria "Ações administrativas"): foto adicionada, fotos reordenadas, foto removida, texto alternativo alterado. Só IDs e textos curtos; nunca bytes, caminho, URL ou nome original.

## Configurar (uma vez)

1. No painel do Supabase: **Project Settings → API**. Copie a **Project URL** (`https://<projeto>.supabase.co`) e a chave **`service_role`** (secret).
2. No `.env` (e nas variáveis do provedor de hospedagem), **sem** o prefixo `NEXT_PUBLIC_`:
   ```
   SUPABASE_URL="https://<projeto>.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY="..."
   ```
   A `service_role` ignora o RLS. Trate-a como a senha do banco: só no servidor, nunca em código do navegador, log, commit ou print. Se vazar, gere outra no painel e atualize a variável.
3. Crie o bucket (idempotente):
   ```
   npm run storage:setup
   ```
   Ou, à mão, em **Storage → New bucket**: nome `service-images`, **Public bucket** ligado, limite de arquivo `8 MB`, tipos permitidos `image/webp`. **Não crie nenhuma política de escrita** (nem para `anon`, nem para `authenticated`).
4. Aplique a migração `20261119000000_service_images` (cria `ServiceImage` e `StorageCleanup`, com RLS ligado):
   ```
   npm run db:deploy
   ```
5. Reinicie o servidor. Em **Admin → Serviços → Editar**, adicione as fotos.

**Ordem na publicação:** backup → `npm run db:deploy` → `npm run storage:setup` → publicar o código. Sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` nada quebra: o painel avisa que o armazenamento não está configurado e o site usa os placeholders.

O `next.config.mjs` autoriza o `next/image` a buscar fotos **somente** do host de `SUPABASE_URL` e **somente** do caminho `/storage/v1/object/public/service-images/**`. Se mudar de projeto Supabase, reinicie/recompile o site. O CSP não precisa mudar (`img-src 'self'`), porque o navegador só pede imagens ao próprio site.

## Manutenção

- `npm run storage:cleanup`: apaga do Storage os arquivos pendentes de `StorageCleanup` (seguro repetir; nunca apaga um arquivo que ainda tenha foto cadastrada).
- Backup: o `npm run db:backup` guarda os **metadados**. Os arquivos ficam no Supabase Storage (faça o backup do bucket pelo painel se precisar de cópia).
- Trocar uma foto: envie a nova e remova a antiga (a antiga só some depois que a nova foi processada e salva).

## Regras de segurança (não quebrar)

- Nunca confiar em `File.type` nem na extensão: só nos bytes (`detectType` + decodificação do `sharp`).
- Nunca usar o nome enviado pelo navegador no caminho: o servidor gera `services/{serviceId}/{uuid}.webp`.
- Toda foto é buscada por `id` **e** `serviceId`: o ID de uma foto de outro serviço responde "não encontrado".
- Nenhuma chamada de rede dentro da transação do banco.
- Nada de bytes, chave, URL ou nome original em log ou auditoria.

## Testes

`tests/service-images.test.ts` (Storage falso em memória, banco PostgreSQL descartável) cobre: permissões (ADMIN, cliente, visitante), arquivos inválidos/corrompidos/animados/grandes, conversão para WebP sem EXIF, o teto de 6 com 10 envios simultâneos, capa e ordem, remoção da capa, ID de outro serviço, falhas do banco e do Storage (sem órfãos), limpeza pendente, auditoria sem dados sensíveis, placeholder e foto na vitrine, e serviços/reservas intactos. `e2e/fotos.spec.ts` percorre o fluxo no navegador com um Storage falso local.
