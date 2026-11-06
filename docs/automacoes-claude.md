# Automações sugeridas do Claude Code

Avaliadas para este repositório. **Nenhuma está ativada**: hooks executam comandos na sua máquina, então ficam como proposta para você aplicar. O subagente revisor foi adicionado em `.claude/agents/revisor-reservas.md` (só lê arquivos).

## 1. Hook: tipos + testes focados ao mexer em reservas, disponibilidade ou autenticação

**Quando:** depois de editar `src/lib/booking.ts`, `src/lib/availability.ts`, `src/lib/auth.ts`, `src/lib/rate-limit.ts` ou `src/lib/google-calendar.ts`.
**O que verifica:** `tsc --noEmit` e os testes que cobrem esses arquivos (cerca de 10 s). Falha bloqueia o fluxo com a mensagem do erro.

`.claude/settings.json` (sugestão):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/hooks/verify-core.mjs"
          }
        ]
      }
    ]
  }
}
```

`scripts/hooks/verify-core.mjs` (sugestão; lê o JSON do evento em stdin):

```js
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const event = JSON.parse(readFileSync(0, "utf8"));
const file = String(event.tool_input?.file_path ?? "").replace(/\\/g, "/");
const watched = /src\/lib\/(booking|availability|auth|rate-limit|google-calendar|policy)\.ts$/;
if (!watched.test(file)) process.exit(0);

try {
  execSync("npx tsc --noEmit", { stdio: "pipe" });
  execSync("npx vitest run tests/booking-integrity.test.ts tests/client-policy.test.ts tests/auth-hardening.test.ts tests/google-sync.test.ts", { stdio: "pipe" });
} catch (err) {
  console.error(String(err.stdout ?? err.message).slice(-3000));
  process.exit(2); // exit 2 devolve a mensagem ao Claude
}
```

## 2. Hook de proteção (PreToolUse)

**Quando:** antes de editar `.env`, `prisma/migrations/**` ou `prisma/postgres/migrations/**` já existentes. **O que faz:** bloqueia, porque migração aplicada nunca deve ser editada (crie outra) e `.env` guarda segredos.

## 3. Subagente revisor de permissões e reservas

Arquivo: `.claude/agents/revisor-reservas.md`. **Quando usar:** ao alterar qualquer `actions.ts`, `session.ts`, `middleware.ts`, `booking.ts`, `availability.ts`, `google-calendar.ts` ou migrações. **O que verifica:** toda Server Action chama `requireAdmin`/`requireClient`; reserva de outra cliente responde "não encontrada"; toda mudança na agenda usa `runLocked`; nenhuma chamada de rede dentro da transação; PII fora dos logs; regex e escapes. Na revisão desta entrega ele achou uma regressão real.

## 4. Não vale a pena agora

- **MCP de banco/Google:** só quando houver credenciais reais e uma tarefa recorrente que as exija.
- **Hook rodando a suíte inteira a cada edição:** lento demais (o `test:pg` e o `test:e2e` levam minutos); deixe para antes de publicar ou para o CI.
