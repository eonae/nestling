import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit: миграции генерируются из схемы приложения.
 *
 * Миграции накатываются вне процесса приложения: приложение, которое
 * мигрирует себя само при старте, требует блокировки между репликами.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://users:users@localhost:5432/users',
  },
});
