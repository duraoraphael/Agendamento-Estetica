-- Segurança em nível de linha (RLS) em TODAS as tabelas da aplicação.
--
-- Por quê: o Supabase expõe o schema "public" por uma API REST (PostgREST) acessível com a chave "anon", que é
-- PÚBLICA. Tabela sem RLS ali pode ser lida e escrita por qualquer pessoa na internet, o que inclui "User" com os
-- hashes de senha e "GoogleCalendarAccount" com tokens (cifrados).
--
-- Como protege: RLS ligado e NENHUMA política = os papéis "anon" e "authenticated" não leem nem gravam nada.
-- A aplicação não é afetada: o Prisma conecta como o papel "postgres" (dono das tabelas), que ignora o RLS.
-- NÃO use FORCE ROW LEVEL SECURITY: ele sujeitaria o próprio dono (a aplicação) às políticas e a derrubaria.
--
-- REGRA PARA O FUTURO: toda migração que criar uma tabela deve terminar com
--   ALTER TABLE "NovaTabela" ENABLE ROW LEVEL SECURITY;
-- (veja CLAUDE.md). Em bancos que não são do Supabase (testes locais), o RLS ligado é inofensivo.

ALTER TABLE "User"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Service"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessHours"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockedPeriod"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingLock"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoogleCalendarAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimit"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteSettings"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteLogo"              ENABLE ROW LEVEL SECURITY;

-- Tabela de controle do próprio Prisma (histórico de migrações): também fica fora da API pública.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Defesa em profundidade (só onde os papéis do Supabase existem): tira também os privilégios das tabelas,
-- inclusive para tabelas criadas no futuro por este mesmo usuário. Se alguém desligar o RLS por engano, a API
-- pública continua sem acesso.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;
