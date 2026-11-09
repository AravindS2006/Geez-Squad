import 'server-only';
import { PrismaClient } from '@prisma/client';
export { databaseProvider, isSqliteDatabase, type DatabaseProvider } from './db-provider';
const globalDb = globalThis as unknown as { geezSquadDb?: PrismaClient };
export const db = globalDb.geezSquadDb ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.geezSquadDb = db;
