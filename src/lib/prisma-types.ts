import type { Prisma, PrismaClient } from "@prisma/client";

/** Aceita tanto o client normal quanto o client de dentro de uma `$transaction`. */
export type Db = PrismaClient | Prisma.TransactionClient;
