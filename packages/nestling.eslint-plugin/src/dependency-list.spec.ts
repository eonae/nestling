/**
 * `dependency-list`: что правило выводит из типов параметров, что ловит
 * и — важнее — где молчит.
 *
 * Валидных кейсов больше, чем невалидных, и это соотношение
 * содержательно: правило синтаксическое, поэтому каждая строка таблицы и
 * каждая форма молчания зафиксированы тестом.
 */

import { dependencyList } from './dependency-list.js';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

/**
 * Пролог фикстур: импорты значением, импорты только типа и объявления в
 * файле — всё, по чему правило различает класс, интерфейс и DI-токен.
 */
const prelude = `
  import { Component, Handler, Resource } from '@nestlingjs/container';
  import type { Config, CtxReader, Emitter, HealthCheck, Logger, Port } from '@nestlingjs/app';
  import { Ctx, HealthCheck$, Logger$, RequestId } from '@nestlingjs/app';
  import { Database } from './database.js';
  import type { UsersRepository } from './users.repository.js';
  import { UsersRepository$ } from './users.repository.js';
  import { AppConfig } from './app.config.js';
  import { ClaimQuota, UserRegistered } from './operations.js';
  import type { Counter } from './counters.js';
  import { Counter$ } from './counters.js';
`;

ruleTester.run('dependency-list', dependencyList, {
  valid: [
    {
      name: 'класс из импорта значением',
      code: `${prelude}
        @Component([Database])
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
    },
    {
      name: 'класс из объявления в файле',
      code: `${prelude}
        class Clock {}
        @Component([Clock])
        class Scheduler {
          constructor(private readonly clock: Clock) {}
        }`,
    },
    {
      name: 'секция конфига: Config<typeof X> даёт X',
      code: `${prelude}
        @Handler([AppConfig])
        class Authenticate {
          constructor(private readonly config: Config<typeof AppConfig>) {}
          async handle() {}
        }`,
    },
    {
      name: 'вызыватель и эмиттер операции',
      code: `${prelude}
        @Component([ClaimQuota.caller, UserRegistered.emitter])
        class RegistrationService {
          constructor(
            private readonly quotas: Port<typeof ClaimQuota>,
            private readonly registered: Emitter<typeof UserRegistered>,
          ) {}
        }`,
    },
    {
      name: 'Logger при Logger$.auto',
      code: `${prelude}
        @Handler([Logger$.auto])
        class Observability {
          constructor(private readonly logger: Logger) {}
          async handle() {}
        }`,
    },
    {
      name: "Logger при явном члене семейства Logger$('db')",
      code: `${prelude}
        @Component([Logger$('db')])
        class AppService {
          constructor(private readonly logger: Logger) {}
        }`,
    },
    {
      name: 'интерфейс при видимом DI-токене X$',
      code: `${prelude}
        @Handler([UsersRepository$])
        class GetUserHandler {
          constructor(private readonly users: UsersRepository) {}
          async handle() {}
        }`,
    },
    {
      name: "член семейства Counter$('users') для типа Counter",
      code: `${prelude}
        @Component([Counter$('users')])
        class UserService {
          constructor(private readonly calls: Counter) {}
        }`,
    },
    {
      name: 'массив вкладов: readonly HealthCheck[] при HealthCheck$.all',
      code: `${prelude}
        @Component([HealthCheck$.all])
        class Demo {
          constructor(private readonly checks: readonly HealthCheck[]) {}
        }`,
    },
    {
      name: 'массив вкладов: ReadonlyArray<HealthCheck> и HealthCheck[]',
      code: `${prelude}
        @Component([HealthCheck$.all, HealthCheck$.all])
        class Demo {
          constructor(a: ReadonlyArray<HealthCheck>, b: HealthCheck[]) {}
        }`,
    },
    {
      name: 'класс, зарегистрированный под DI-токеном: видимый X$ сильнее',
      code: `${prelude}
        import { Storage, Storage$ } from './storage.js';
        @Component([Storage$])
        class Uploads {
          constructor(private readonly storage: Storage) {}
        }`,
    },
    {
      name: 'класс с именем Logger, объявленный в файле, — обычный класс',
      code: `
        import { Component } from '@nestlingjs/container';
        class Logger {}
        @Component([Logger])
        class Greeter {
          constructor(readonly logger: Logger) {}
        }`,
    },
    {
      name: 'Logger без видимого Logger$ — позиция непрозрачна',
      code: `
        import type { Logger } from '@nestlingjs/app';
        import { RootLogger$ } from '@nestlingjs/app';
        import { Component } from '@nestlingjs/container';
        @Component([RootLogger$])
        class AppService {
          constructor(private readonly logger: Logger) {}
        }`,
    },
    {
      name: 'многострочный список из всех строк таблицы',
      code: `${prelude}
        @Component([
          Database,
          UsersRepository$,
          Logger$('app'),
          HealthCheck$.all,
          AppConfig,
          Counter$('users'),
          ClaimQuota.caller,
        ])
        class Demo {
          constructor(
            private readonly db: Database,
            private readonly users: UsersRepository,
            private readonly logger: Logger,
            private readonly checks: readonly HealthCheck[],
            private readonly config: Config<typeof AppConfig>,
            private readonly calls: Counter,
            private readonly quotas: Port<typeof ClaimQuota>,
          ) {}
        }`,
    },
    {
      name: 'выражение класса',
      code: `${prelude}
        const Service = @Component([Database]) class {
          constructor(private readonly db: Database) {}
        };`,
    },

    // Непрозрачные позиции: тип вне таблицы принимает написанное
    {
      name: 'CtxReader<T> при Ctx(Var) — позиция непрозрачна',
      code: `${prelude}
        @Component([Database, Logger$.auto, Ctx(RequestId)])
        class DbUsersRepository {
          constructor(
            private readonly db: Database,
            private readonly logger: Logger,
            private readonly requestId: CtxReader<string>,
          ) {}
        }`,
    },
    {
      name: 'Set<string> — глобальный тип с аргументом',
      code: `${prelude}
        const SeenKeys$ = makeToken('SeenKeys');
        @Handler([Logger$.auto, SeenKeys$])
        class WelcomeEmailHandler {
          constructor(logger: Logger, private readonly seen: Set<string>) {}
          async handle() {}
        }`,
    },
    {
      name: 'import type без DI-токена рядом — не класс',
      code: `${prelude}
        import type { Mailer } from './mailer.js';
        import { mailerToken } from './mailer.js';
        @Component([mailerToken])
        class Notifier {
          constructor(private readonly mailer: Mailer) {}
        }`,
    },
    {
      name: 'import { type X } без DI-токена рядом — не класс',
      code: `${prelude}
        import { type Mailer, mailerToken } from './mailer.js';
        @Component([mailerToken])
        class Notifier {
          constructor(private readonly mailer: Mailer) {}
        }`,
    },
    {
      name: 'интерфейс из файла без DI-токена рядом',
      code: `${prelude}
        interface Mailer { send(): void }
        @Component([something])
        class Notifier {
          constructor(private readonly mailer: Mailer) {}
        }`,
    },
    {
      name: 'глобальные типы без привязки: Date, AbortSignal',
      code: `${prelude}
        @Component([Clock$, Shutdown$])
        class Scheduler {
          constructor(private readonly now: Date, signal: AbortSignal) {}
        }`,
    },
    {
      name: 'тип из сателлита: OutboxEmitter<typeof Op> при outboxed(Op)',
      code: `${prelude}
        import type { OutboxEmitter } from '@nestlingjs/outbox';
        import { outboxed } from '@nestlingjs/outbox';
        @Handler([outboxed(UserRegistered)])
        class CreateUserHandler {
          constructor(private readonly registered: OutboxEmitter<typeof UserRegistered>) {}
          async handle() {}
        }`,
    },
    {
      name: 'параметр без аннотации типа',
      code: `${prelude}
        @Component([whatever])
        class Loose {
          constructor(dependency) {}
        }`,
    },

    // Молчание: сравнивать нечего
    {
      name: 'список приходит переменной',
      code: `${prelude}
        @Component(deps)
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
    },
    {
      name: 'spread в списке',
      code: `${prelude}
        @Handler([...common, Logger$.auto])
        class Observability {
          constructor(private readonly db: Database, private readonly logger: Logger) {}
          async handle() {}
        }`,
    },
    {
      name: 'аргумент декоратора — не список',
      code: `${prelude}
        @Component(Logger$, [])
        class WithToken {
          constructor(private readonly logger: Logger) {}
        }`,
    },
    {
      name: 'класс без собственного конструктора',
      code: `${prelude}
        @Component([])
        class Derived extends Base {}`,
    },
    {
      name: 'унаследованный конструктор при непустом списке',
      code: `${prelude}
        @Component([Database])
        class Derived extends Base {}`,
    },
    {
      name: 'ресурс без static acquire',
      code: `${prelude}
        @Resource([Database])
        class Broken {
          constructor(private readonly db: Database) {}
          release() {}
        }`,
    },
    {
      name: 'декоратор вызван через член',
      code: `${prelude}
        @container.Component([])
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
    },
    {
      name: 'класс без декоратора роли',
      code: `${prelude}
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
    },

    // Длина: диапазон и rest
    {
      name: 'необязательный параметр: список короче',
      code: `${prelude}
        @Component([Database])
        class UsersService {
          constructor(db: Database, logger?: Logger) {}
        }`,
    },
    {
      name: 'необязательный параметр: список полный',
      code: `${prelude}
        @Component([Database, Logger$.auto])
        class UsersService {
          constructor(db: Database, logger?: Logger) {}
        }`,
    },
    {
      name: 'параметр со значением по умолчанию — необязательный',
      code: `${prelude}
        @Component([Database])
        class UsersService {
          constructor(db: Database, retries: number = 3) {}
        }`,
    },
    {
      name: 'rest-параметр снимает верхнюю границу',
      code: `${prelude}
        @Component([Database, Database, Database])
        class Pool {
          constructor(...connections: Database[]) {}
        }`,
    },
    {
      name: 'пустой список при конструкторе без параметров',
      code: `${prelude}
        @Component()
        class Clock {
          constructor() {}
        }`,
    },

    // Ресурс
    {
      name: 'ресурс: параметры acquire без сигнала',
      code: `${prelude}
        @Resource([AppConfig, Logger$.auto])
        class Database {
          static async acquire(
            config: Config<typeof AppConfig>,
            logger: Logger,
            _signal: AbortSignal,
          ): Promise<Database> {}
          private constructor(private readonly logger: Logger) {}
          release() {}
        }`,
    },
    {
      name: 'ресурс без зависимостей: acquire получает один сигнал',
      code: `${prelude}
        @Resource([])
        class ActivityHub {
          static async acquire(_signal: AbortSignal) {}
          release() {}
        }`,
    },
  ],

  invalid: [
    {
      // Заодно предмет проверки — текст: сообщение обязано называть свой
      // статус подсказки и компилятор как гарантию
      name: 'пустой список при непустом конструкторе — автофикс',
      code: `${prelude}
        @Handler()
        class CreateUserHandler {
          constructor(users: UsersRepository, config: Config<typeof AppConfig>) {}
          async handle() {}
        }`,
      output: `${prelude}
        @Handler([UsersRepository$, AppConfig])
        class CreateUserHandler {
          constructor(users: UsersRepository, config: Config<typeof AppConfig>) {}
          async handle() {}
        }`,
      errors: [
        {
          message:
            'Dependency list of CreateUserHandler has 0 dependency tokens, ' +
            'but the constructor takes 2 parameters. This is an editor ' +
            'hint, not a guarantee: the compiler checks the list against ' +
            'the parameters.',
        },
      ],
    },
    {
      name: 'пустой литерал при непустом конструкторе — автофикс',
      code: `${prelude}
        @Component([])
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
      output: `${prelude}
        @Component([Database])
        class UsersService {
          constructor(private readonly db: Database) {}
        }`,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'недостающий последний DI-токен — автофикс дописывает',
      code: `${prelude}
        @Component([Database])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
      output: `${prelude}
        @Component([Database, Logger$.auto])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'написанный член семейства автофикс не трогает',
      code: `${prelude}
        @Component([Logger$('db')])
        class UsersService {
          constructor(logger: Logger, db: Database) {}
        }`,
      output: `${prelude}
        @Component([Logger$('db'), Database])
        class UsersService {
          constructor(logger: Logger, db: Database) {}
        }`,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'лишний DI-токен — автофикс убирает',
      code: `${prelude}
        @Component([Database, Logger$.auto, AppConfig])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
      output: `${prelude}
        @Component([Database, Logger$.auto])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'необязательный параметр при трёх элементах',
      code: `${prelude}
        @Component([Database, Logger$.auto, AppConfig])
        class UsersService {
          constructor(db: Database, logger?: Logger) {}
        }`,
      output: `${prelude}
        @Component([Database, Logger$.auto])
        class UsersService {
          constructor(db: Database, logger?: Logger) {}
        }`,
      errors: [
        {
          messageId: 'length',
          data: {
            className: 'UsersService',
            written: '3 dependency tokens',
            source: 'the constructor',
            expected: '1 to 2 parameters',
          },
        },
      ],
    },
    {
      name: 'rest-параметр: список короче обязательных',
      code: `${prelude}
        @Component([])
        class Pool {
          constructor(db: Database, ...rest: Database[]) {}
        }`,
      output: `${prelude}
        @Component([Database])
        class Pool {
          constructor(db: Database, ...rest: Database[]) {}
        }`,
      errors: [
        {
          messageId: 'length',
          data: {
            className: 'Pool',
            written: '0 dependency tokens',
            source: 'the constructor',
            expected: 'at least 1 parameter',
          },
        },
      ],
    },
    {
      name: 'длина расходится при непрозрачной позиции — без автофикса',
      code: `${prelude}
        @Component([Database])
        class DbUsersRepository {
          constructor(db: Database, requestId: CtxReader<string>) {}
        }`,
      output: null,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'пустой список при Logger без видимого Logger$ — без автофикса',
      code: `
        import type { Logger } from '@nestlingjs/app';
        import { Component } from '@nestlingjs/container';
        @Component()
        class AppService {
          constructor(private readonly logger: Logger) {}
        }`,
      output: null,
      errors: [{ messageId: 'length' }],
    },
    {
      name: 'ресурс: недостающий DI-токен — автофикс',
      code: `${prelude}
        @Resource([AppConfig])
        class Database {
          static async acquire(
            config: Config<typeof AppConfig>,
            logger: Logger,
            _signal: AbortSignal,
          ) {}
          release() {}
        }`,
      output: `${prelude}
        @Resource([AppConfig, Logger$.auto])
        class Database {
          static async acquire(
            config: Config<typeof AppConfig>,
            logger: Logger,
            _signal: AbortSignal,
          ) {}
          release() {}
        }`,
      errors: [
        {
          messageId: 'length',
          data: {
            className: 'Database',
            written: '1 dependency token',
            source: 'static acquire (signal excluded)',
            expected: '2 parameters',
          },
        },
      ],
    },
    {
      name: 'выражение класса с пустым списком',
      code: `${prelude}
        const Service = @Component() class {
          constructor(private readonly db: Database) {}
        };`,
      output: `${prelude}
        const Service = @Component([Database]) class {
          constructor(private readonly db: Database) {}
        };`,
      errors: [
        {
          messageId: 'length',
          data: {
            className: 'the anonymous class',
            written: '0 dependency tokens',
            source: 'the constructor',
            expected: '1 parameter',
          },
        },
      ],
    },

    // Расхождение элемента: suggestion, автофикса нет
    {
      name: 'класс с именем Logger при видимом Logger$: семейство сильнее',
      code: `${prelude}
        class Logger {}
        @Component([Logger])
        class Greeter {
          constructor(readonly logger: Logger) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'Greeter',
            parameter: 'logger',
            type: 'Logger',
            expected: 'Logger$.auto',
            written: 'Logger',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        class Logger {}
        @Component([Logger$.auto])
        class Greeter {
          constructor(readonly logger: Logger) {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'DI-токен другого имени — suggestion',
      code: `${prelude}
        @Handler([UsersRepo$])
        class GetUserHandler {
          constructor(private readonly users: UsersRepository) {}
          async handle() {}
        }`,
      output: null,
      errors: [
        {
          message:
            "Dependency list of GetUserHandler: parameter 'users: " +
            "UsersRepository' expects 'UsersRepository$', but the list has " +
            "'UsersRepo$' in its position. This is an editor hint, not a " +
            'guarantee: the compiler checks the list against the parameters.',
          suggestions: [
            {
              messageId: 'replace',
              data: { expected: 'UsersRepository$' },
              output: `${prelude}
        @Handler([UsersRepository$])
        class GetUserHandler {
          constructor(private readonly users: UsersRepository) {}
          async handle() {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'нестандартный DI-токен известного типа: RootLogger$ для Logger',
      code: `${prelude}
        import { RootLogger$ } from '@nestlingjs/app';
        @Component([RootLogger$])
        class AppService {
          constructor(private readonly logger: Logger) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'AppService',
            parameter: 'logger',
            type: 'Logger',
            expected: 'Logger$.auto',
            written: 'RootLogger$',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        import { RootLogger$ } from '@nestlingjs/app';
        @Component([Logger$.auto])
        class AppService {
          constructor(private readonly logger: Logger) {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'вызыватель другой операции',
      code: `${prelude}
        @Component([UserRegistered.caller])
        class RegistrationService {
          constructor(private readonly quotas: Port<typeof ClaimQuota>) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'RegistrationService',
            parameter: 'quotas',
            type: 'Port<typeof ClaimQuota>',
            expected: 'ClaimQuota.caller',
            written: 'UserRegistered.caller',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        @Component([ClaimQuota.caller])
        class RegistrationService {
          constructor(private readonly quotas: Port<typeof ClaimQuota>) {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'класс, зарегистрированный под DI-токеном, написан классом',
      code: `${prelude}
        import { Storage, Storage$ } from './storage.js';
        @Component([Storage])
        class Uploads {
          constructor(private readonly storage: Storage) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'Uploads',
            parameter: 'storage',
            type: 'Storage',
            expected: 'Storage$',
            written: 'Storage',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        import { Storage, Storage$ } from './storage.js';
        @Component([Storage$])
        class Uploads {
          constructor(private readonly storage: Storage) {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'перепутанный порядок: по сообщению на каждую позицию',
      code: `${prelude}
        @Component([Logger$.auto, Database])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'UsersService',
            parameter: 'db',
            type: 'Database',
            expected: 'Database',
            written: 'Logger$.auto',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        @Component([Database, Database])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
            },
          ],
        },
        {
          messageId: 'mismatch',
          data: {
            className: 'UsersService',
            parameter: 'logger',
            type: 'Logger',
            expected: 'Logger$.auto',
            written: 'Database',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        @Component([Logger$.auto, Logger$.auto])
        class UsersService {
          constructor(db: Database, logger: Logger) {}
        }`,
            },
          ],
        },
      ],
    },
    {
      name: 'непрозрачная позиция среди известных проверку не глушит',
      code: `${prelude}
        @Component([Database, RootLogger$, Ctx(RequestId)])
        class DbUsersRepository {
          constructor(
            private readonly db: Database,
            private readonly logger: Logger,
            private readonly requestId: CtxReader<string>,
          ) {}
        }`,
      output: null,
      errors: [
        {
          messageId: 'mismatch',
          data: {
            className: 'DbUsersRepository',
            parameter: 'logger',
            type: 'Logger',
            expected: 'Logger$.auto',
            written: 'RootLogger$',
          },
          suggestions: [
            {
              messageId: 'replace',
              output: `${prelude}
        @Component([Database, Logger$.auto, Ctx(RequestId)])
        class DbUsersRepository {
          constructor(
            private readonly db: Database,
            private readonly logger: Logger,
            private readonly requestId: CtxReader<string>,
          ) {}
        }`,
            },
          ],
        },
      ],
    },
  ],
});
