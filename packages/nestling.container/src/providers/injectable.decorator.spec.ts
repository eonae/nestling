/**
 * Список зависимостей `@Injectable` против конструктора: длина, типы и
 * порядок сверяются на компиляции.
 */

import { makeToken } from '../tokens.js';

import { Injectable } from './injectable.decorator.js';
import { readInjectableMeta } from './injectable.metadata.js';

import { describe, expect, it } from '@jest/globals';

interface ILogger {
  log(message: string): void;
}

const Logger$ = makeToken<ILogger>('Logger');

@Injectable([])
class UsersRepository {
  find(): string {
    return 'user';
  }
}

describe('@Injectable — длина списка зависимостей', () => {
  it('список по числу параметров конструктора компилируется', () => {
    @Injectable([UsersRepository, Logger$])
    class Service {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(readInjectableMeta(Service)?.dependencies).toEqual([
      UsersRepository,
      Logger$,
    ]);
  });

  it('лишний токен — ошибка компиляции', () => {
    // @ts-expect-error: конструктор принимает один параметр, токенов два
    @Injectable([UsersRepository, Logger$])
    class TooMany {
      constructor(readonly repo: UsersRepository) {}
    }

    expect(TooMany).toBeDefined();
  });

  it('недостающий токен — ошибка компиляции', () => {
    // @ts-expect-error: конструктор требует два параметра, токен один
    @Injectable([UsersRepository])
    class TooFew {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(TooFew).toBeDefined();
  });

  it('необязательный параметр принимает список любой допустимой длины', () => {
    @Injectable([UsersRepository])
    class WithoutLogger {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    @Injectable([UsersRepository, Logger$])
    class WithLogger {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    // @ts-expect-error: параметров самое большее два, токенов три
    @Injectable([UsersRepository, Logger$, Logger$])
    class TooMany {
      constructor(
        readonly repo: UsersRepository,
        readonly logger?: ILogger,
      ) {}
    }

    expect([WithoutLogger, WithLogger, TooMany].every(Boolean)).toBe(true);
  });

  it('rest-параметр принимает список любой длины', () => {
    @Injectable([UsersRepository, UsersRepository, UsersRepository])
    class Many {
      readonly repos: UsersRepository[];

      constructor(...repos: UsersRepository[]) {
        this.repos = repos;
      }
    }

    expect(Many).toBeDefined();
  });

  it('порядок токенов сверяется с параметрами', () => {
    // @ts-expect-error: порядок токенов не совпадает с порядком параметров
    @Injectable([Logger$, UsersRepository])
    class Swapped {
      constructor(
        readonly repo: UsersRepository,
        readonly logger: ILogger,
      ) {}
    }

    expect(Swapped).toBeDefined();
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
      Injectable as unknown as (
        deps: unknown[],
      ) => (target: unknown, context?: unknown) => unknown
    )([UsersRepository]);

    expect(() => decorate(NeedsTwo)).not.toThrow();
  });
});
