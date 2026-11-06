// Parâmetros do PostgreSQL de teste (servidor embutido, descartável).
export const PG_TEST_PORT = 54330;
export const PG_TEST_USER = "postgres";
export const PG_TEST_PASSWORD = "pg-test-only";
export const PG_TEST_DB = "agenda_test";
export const PG_TEST_URL = `postgresql://${PG_TEST_USER}:${PG_TEST_PASSWORD}@127.0.0.1:${PG_TEST_PORT}/${PG_TEST_DB}`;
/** URL do servidor sem banco específico (para criar bancos extras: restauração, migração). */
export const PG_TEST_URL_FOR = (db: string) => `postgresql://${PG_TEST_USER}:${PG_TEST_PASSWORD}@127.0.0.1:${PG_TEST_PORT}/${db}`;
