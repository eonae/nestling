import { authed } from './auth.js';
import type { Transaction } from './database.js';
import { Database } from './database.js';

import type { ExtendableContext, Plugin } from '@nestlingjs/app';
import { compose, contextVar, makePipeline, makePlugin } from '@nestlingjs/app';
import { Handler, makeToken } from '@nestlingjs/container';
import type { OutboxStore } from '@nestlingjs/outbox';

/**
 * Транзакция запроса.
 *
 * Переменную объявляет приложение своим типом: `@nestlingjs/outbox` её
 * только читает и передаёт хранилищу непрозрачно.
 */
export const Tx = contextVar<Transaction>()('tx');

/** DI-токен хранилища outbox'а: его инжектит relay пакета */
export const OutboxStore$ = makeToken<OutboxStore>('OutboxStore');

/**
 * Юнит-мост: кладёт соединение в контекст.
 *
 * Он нужен, потому что `Tx.provide(compute)` принимает функцию от
 * контекста и зависимостей из контейнера не получает, а соединение
 * приходит именно оттуда.
 */
@Handler([Database])
export class ProvideDb {
  constructor(private readonly db: Database) {}

  handle(): { db: Database } {
    return { db: this.db };
  }
}

/**
 * Слой транзакции поверх `authed`.
 *
 * Транзакция открывается пайплайном, а не колбэком `db.transaction(cb)`:
 * снаружи колбэка транзакции нет, и репозиторий с эмиттером не смогли бы
 * её прочитать. `.ok` коммитит, `.catch` откатывает — оба видят
 * накопленный контекст.
 */
export const transactional = compose(
  authed,
  makePipeline()
    .pre(ProvideDb)
    .pre(Tx.provide<{ db: Database }>((ctx) => ctx.input.db.begin()))
    .ok((_res, ctx: ExtendableContext<{ tx: Transaction }>) => {
      ctx.input.tx.commit();
    })
    // На дорожке ответа контекст `Partial`: до писателя переменной
    // пайплайн мог и не дойти
    /* eslint-disable-next-line unicorn/catch-error-name --
     * Это не catch-клауза, а `.catch`-юнит пайплайна: первый параметр —
     * контекст ответа-отказа, и называть его `error` было бы неверно. */
    .catch((_res, ctx: ExtendableContext<{ tx?: Transaction }>) => {
      ctx.input.tx?.rollback();
    }),
);

/**
 * Инфраструктура хранения: соединение, хранилище outbox'а и юнит слоя.
 *
 * Плагин, а не фича: `outbox(...)` — тоже плагин, и его relay инжектит
 * `OutboxStore$`. DI-токен фичи в зависимостях плагина уронил бы сборку
 * проверкой границы фич — инфраструктура, которая знает о бизнес-логике,
 * не переиспользуется и не отгружается отдельно.
 */
export const persistence: Plugin = makePlugin({
  name: 'persistence',
  providers: [
    Database,
    ProvideDb,
    {
      provide: OutboxStore$,
      useFactory: (db: Database) => db.outbox,
      deps: [Database],
    },
  ],
});
