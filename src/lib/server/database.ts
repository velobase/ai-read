import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const shared = globalThis as unknown as { readerDatabase?: PrismaClient };

export const database =
  shared.readerDatabase ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }),
  });

if (process.env.NODE_ENV !== 'production') shared.readerDatabase = database;
