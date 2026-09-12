/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @nestlingjs/dependency-list -- негативные случаи расходятся с конструктором намеренно: их отвергает компилятор */

/**
 * Три роли класса: метаданные, списки зависимостей и запрещённые формы.
 *
 * Длину, типы и порядок списка сверяет компилятор, поэтому негативные
 * случаи закрыты `@ts-expect-error`: исчезни ошибка — упадёт `tsc`.
 */

import { makeToken } from '../tokens.js';

import { Component, Handler, Resource } from './role.decorators.js';
import { readRoleMeta } from './role.metadata.js';

import { describe, expect, it } from '@jest/globals';

interface ILogger {
  log(message: string): void;
}

const Logger$ = makeToken<ILogger>('Logger');

@Component([])
class UsersRepository {
  find(): string {
    return 'user';
  }
}

describe('роли классов', () => {
  it('@Component записывает роль и список зависимостей', () => {
    @Component([UsersRepository, Logger$])
    class Service {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(readRoleMeta(Service)).toEqual({
      role: 'component',
      dependencies: [UsersRepository, Logger$],
    });
  });

  it('@Component() — то же, что @Component([])', () => {
    @Component()
    class Empty {}

    expect(readRoleMeta(Empty)).toEqual({
      role: 'component',
      dependencies: [],
    });
  });

  it('@Handler записывает роль хендлера', () => {
    @Handler([UsersRepository])
    class CreateUserHandler {
      constructor(readonly repo: UsersRepository) {}

      handle(): string {
        return this.repo.find();
      }
    }

    expect(readRoleMeta(CreateUserHandler)?.role).toBe('handler');
  });

  it('@Resource записывает роль ресурса', () => {
    @Resource([Logger$])
    class Database {
      static async acquire(
        logger: ILogger,
        _signal: AbortSignal,
      ): Promise<Database> {
        logger.log('connect');
        return new Database();
      }

      release(): void {}
    }

    expect(readRoleMeta(Database)).toEqual({
      role: 'resource',
      dependencies: [Logger$],
    });
  });
});

describe('форма класса под декоратором роли', () => {
  it('компонент с методом handle — ошибка компиляции', () => {
    // @ts-expect-error: класс с `handle` — хендлер, нужен @Handler
    @Component([UsersRepository])
    class Endpoint {
      constructor(readonly repo: UsersRepository) {}

      handle(): string {
        return 'ok';
      }
    }

    expect(Endpoint).toBeDefined();
  });

  it('компонент со static acquire — ошибка компиляции', () => {
    // @ts-expect-error: класс со `static acquire` — ресурс, нужен @Resource
    @Component([])
    class Pool {
      static async acquire(): Promise<Pool> {
        return new Pool();
      }

      release(): void {}
    }

    expect(Pool).toBeDefined();
  });

  it('хендлер без handle — ошибка компиляции', () => {
    // @ts-expect-error: @Handler требует метод `handle`
    @Handler([UsersRepository])
    class NotAHandler {
      constructor(readonly repo: UsersRepository) {}
    }

    expect(NotAHandler).toBeDefined();
  });

  it('ресурс без release — ошибка компиляции', () => {
    // @ts-expect-error: @Resource требует метод `release`
    @Resource([])
    class Leaky {
      static async acquire(): Promise<Leaky> {
        return new Leaky();
      }
    }

    expect(Leaky).toBeDefined();
  });
});

describe('длина списка зависимостей', () => {
  it('список по числу параметров конструктора компилируется', () => {
    @Component([UsersRepository, Logger$])
    class Service {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(readRoleMeta(Service)?.dependencies).toHaveLength(2);
  });

  it('лишний DI-токен — ошибка компиляции', () => {
    // @ts-expect-error: конструктор принимает один параметр, DI-токенов два
    @Component([UsersRepository, Logger$])
    class TooMany {
      constructor(readonly repo: UsersRepository) {}
    }

    expect(TooMany).toBeDefined();
  });

  it('недостающий DI-токен — ошибка компиляции', () => {
    // @ts-expect-error: конструктор требует два параметра, DI-токен один
    @Component([UsersRepository])
    class TooFew {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(TooFew).toBeDefined();
  });

  it('необязательный параметр принимает список любой допустимой длины', () => {
    @Component([UsersRepository])
    class WithoutLogger {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    @Component([UsersRepository, Logger$])
    class WithLogger {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    // @ts-expect-error: параметров самое большее два, DI-токенов три
    @Component([UsersRepository, Logger$, Logger$])
    class TooMany {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    expect([WithoutLogger, WithLogger, TooMany].every(Boolean)).toBe(true);
  });

  it('rest-параметр принимает список любой длины', () => {
    @Component([UsersRepository, UsersRepository, UsersRepository])
    class Many {
      readonly repos: UsersRepository[];

      constructor(...repos: UsersRepository[]) {
        this.repos = repos;
      }
    }

    expect(Many).toBeDefined();
  });

  it('порядок DI-токенов сверяется с параметрами', () => {
    // @ts-expect-error: порядок DI-токенов не совпадает с порядком параметров
    @Component([Logger$, UsersRepository])
    class Swapped {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(Swapped).toBeDefined();
  });

  it('эталон ресурса — параметры acquire без сигнала', () => {
    // @ts-expect-error: у `acquire` одна зависимость, `signal` в список не входит
    @Resource([UsersRepository, Logger$])
    class Database {
      static async acquire(
        _repo: UsersRepository,
        _signal: AbortSignal,
      ): Promise<Database> {
        return new Database();
      }

      release(): void {}
    }

    expect(Database).toBeDefined();
  });

  it('длину проверяет только компилятор: рантайм список не сверяет', () => {
    // `Function.length` не отличает необязательный параметр от
    // отсутствующего, поэтому та же проверка на значении отвергала бы
    // список, который компилятор принимает
    class NeedsTwo {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    const decorate = (
      Component as unknown as (
        deps: unknown[],
      ) => (target: unknown, context?: unknown) => unknown
    )([UsersRepository]);

    expect(() => decorate(NeedsTwo)).not.toThrow();
  });
});
