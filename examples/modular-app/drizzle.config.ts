import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit: миграции генерируются из схемы приложения.
 *
 * Схема одна на приложение и на пакеты: таблицы записей outbox'а и
 * отметок приёма приезжают объявлениями из `@nestlingjs/drizzle.pg` и
 * попадают в ту же миграцию, что и таблица пользователей.
 *
 * Миграции накатываются вне процесса приложения: приложение, которое
 * мигрирует себя само при старте, требует блокировки между репликами.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://modular:modular@localhost:5433/modular',
  },
});
