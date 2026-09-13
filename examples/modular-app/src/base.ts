/**
 * Базовый слой развёртывания: трасса и арендатор.
 *
 * Оба значения приходят из-за границы процесса — трасса конвертом
 * сообщения, арендатор конвертом же. Слой возвращает их в контекст
 * запроса, и дальше их читает код любой глубины: `Ctx(TenantId)` —
 * прикладной, поле `traceId` записи — логгер ядра.
 *
 * Слой один на обе фичи. Именно поэтому записи процессов `users` и
 * `notifications` сходятся по одному `traceId`: обе стороны продолжают
 * трассу одним и тем же юнитом.
 */

import { TenantId } from './context.js';

import type { EmptyInput, Pipeline, TraceContext } from '@nestlingjs/app';
import { makePipeline, withTracing } from '@nestlingjs/app';

/**
 * Что слой кладёт в контекст: трасса запроса и арендатор.
 *
 * Тип написан явно, а не выведен: без аннотации TypeScript печатает
 * внутренний путь пакета и отказывается называть тип экспортируемого
 * значения. Алиас, а не интерфейс: параметр `Pipeline` требует
 * совместимости с `AnyInput`, а у интерфейса нет неявной индексной
 * сигнатуры.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type BaseContext = {
  trace: TraceContext;
  tenantId: string;
};

export const base: Pipeline<EmptyInput, BaseContext> = makePipeline()
  .pre(withTracing())
  .pre(TenantId.propagated());
