/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Перечень ресурсов с проверкой состояния: `health` у класса-ресурса и у
 * функциональной формы, читающий метод билдера.
 *
 * Про пробы контейнер не знает: он отвечает, у каких ресурсов есть
 * `health`, а узлы вкладов заводит `@nestlingjs/app`.
 */

import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import type {
  ProviderDefinition,
  ResourceProviderDefinition,
} from '../providers/index.js';
import {
  classProvider,
  Resource,
  resourceProvider,
} from '../providers/index.js';
import { makeSwitch } from '../switches/index.js';

import { ContainerBuilder } from './container.builder.js';

/** Соединение, которое умеет отвечать на вопрос о своём состоянии */
interface Connection {
  release(): void;
}

const Database$ = makeToken<Connection>('Database');
const Cache$ = makeToken<Connection>('Cache');

/** Билдер с единственным провайдером — чтобы прочитать его перечнем */
const builderFor = (provider: ProviderDefinition<any>): ContainerBuilder =>
  new ContainerBuilder().register(provider);

/** Сигнал остановки старта, который никто не взводил */
const neverAborts = (): AbortSignal => new AbortController().signal;

/** Уже отменённый сигнал: по нему видно, что вызов его передал */
const abortedNow = (): AbortSignal => AbortSignal.abort();

describe('ресурсы с health', () => {
  it('переносит метод класса-ресурса в поле определения провайдера', async () => {
    const checked: string[] = [];

    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        return new Database();
      }

      release(): void {}

      async health(signal: AbortSignal): Promise<'ok' | 'degraded' | 'down'> {
        checked.push(`db(aborted=${String(signal.aborted)})`);
        return 'ok';
      }
    }

    const provider = classProvider(Database$, Database);

    expect(builderFor(provider).healthResources()).toMatchObject([
      { token: Database$, id: 'Database' },
    ]);

    // Поле определения вызывает метод захваченного значения и отдаёт ему
    // сигнал вызова
    const { health } = provider as ResourceProviderDefinition<Database>;

    if (!health) {
      throw new Error('health field is missing');
    }

    await expect(
      health(await Database.acquire(neverAborts()), abortedNow()),
    ).resolves.toBe('ok');
    expect(checked).toEqual(['db(aborted=true)']);
  });

  it('видит класс-ресурс, зарегистрированный сам под собой', () => {
    @Resource([])
    class Cache {
      static async acquire(_signal: AbortSignal): Promise<Cache> {
        return new Cache();
      }

      release(): void {}

      async health(): Promise<'ok'> {
        return 'ok';
      }
    }

    const builder = new ContainerBuilder().register(Cache);

    expect(builder.healthResources()).toMatchObject([
      { token: Cache, id: 'Cache' },
    ]);
  });

  it('видит поле health функциональной формы', () => {
    const builder = new ContainerBuilder().register(
      resourceProvider(Cache$, {
        deps: [] as const,
        acquire: () => ({ release: () => {} }),
        release: () => {},
        health: async () => 'degraded' as const,
      }),
    );

    expect(builder.healthResources()).toMatchObject([
      { token: Cache$, id: 'Cache' },
    ]);
  });

  it('не считает вкладом ресурс без health', () => {
    @Resource([])
    class Plain {
      static async acquire(_signal: AbortSignal): Promise<Plain> {
        return new Plain();
      }

      release(): void {}
    }

    const builder = new ContainerBuilder().register(Plain).register(
      resourceProvider(Cache$, {
        deps: [] as const,
        acquire: () => ({ release: () => {} }),
        release: () => {},
      }),
    );

    expect(builder.healthResources()).toEqual([]);
  });

  it('видит раскрытую ветку providers: и не видит невыбранную', () => {
    const Storage = makeSwitch('storage', ['pg', 'memory']);

    const module = makeModule({
      name: 'module:storage',
      providers: [
        Storage.pick({
          pg: [
            resourceProvider(Database$, {
              deps: [] as const,
              acquire: () => ({ release: () => {} }),
              release: () => {},
              health: async () => 'ok' as const,
            }),
          ],
          memory: [
            resourceProvider(Database$, {
              deps: [] as const,
              acquire: () => ({ release: () => {} }),
              release: () => {},
            }),
          ],
        }),
      ],
    });

    const chosen = new ContainerBuilder({ switches: { storage: 'pg' } });
    chosen.register(module);

    expect(chosen.healthResources()).toMatchObject([
      { token: Database$, id: 'Database' },
    ]);

    const other = new ContainerBuilder({ switches: { storage: 'memory' } });
    other.register(module);

    expect(other.healthResources()).toEqual([]);
  });

  it('видит ресурс из фабрики провайдеров модуля, вызвав её один раз', () => {
    let calls = 0;

    const module = makeModule({
      name: 'module:lazy',
      providers: () => {
        calls += 1;

        return [
          resourceProvider(Cache$, {
            deps: [] as const,
            acquire: () => ({ release: () => {} }),
            release: () => {},
            health: async () => 'ok' as const,
          }),
        ];
      },
    });

    const builder = new ContainerBuilder().register(module);

    expect(builder.healthResources()).toMatchObject([
      { token: Cache$, id: 'Cache' },
    ]);

    builder.build();

    expect(calls).toBe(1);
  });
});
