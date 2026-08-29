/** Хук жизненного цикла: синхронная или асинхронная функция без аргументов. */
export type Hook = () => void | Promise<void>;

/** Хуки жизненного цикла одного экземпляра, привязанные к нему. */
export interface LifecycleHooks {
  /** Хуки `@OnInit`: выполняются на фазе INIT */
  onInit: Hook[];
  /**
   * Хуки `@OnStart`: выполняются на фазе START, после `@OnInit` всего графа
   * и после WIRE. Хук `@OnStart` видит полностью собранное приложение,
   * а `@OnInit` — только свои зависимости.
   */
  onStart: Hook[];
  /** Хуки `@OnDestroy`: выполняются на фазе SHUTDOWN */
  onDestroy: Hook[];
}

/**
 * Метаданные хуков класса: имена методов с декораторами `@OnInit`,
 * `@OnStart` и `@OnDestroy`.
 */
export interface LifecycleMetadata {
  /** Имена методов с `@OnInit` */
  onInit: string[];
  /** Имена методов с `@OnStart` */
  onStart: string[];
  /** Имена методов с `@OnDestroy` */
  onDestroy: string[];
}

/** Пустые метаданные: одна форма для всех трёх видов хуков */
const emptyMetadata = (): LifecycleMetadata => ({
  onInit: [],
  onStart: [],
  onDestroy: [],
});

/**
 * Записывает имя декорированного метода в метаданные класса ровно один раз.
 *
 * Инициализатор декоратора выполняется при каждом создании экземпляра,
 * поэтому запись должна быть идемпотентной. Три декоратора используют одну
 * реализацию, чтобы это свойство держалось в одном месте.
 */
function rememberHook(
  constructor: object,
  kind: keyof LifecycleMetadata,
  methodName: string,
): void {
  const metadata = lifecycleMetadata.get(constructor) || emptyMetadata();

  // Метаданные могли быть записаны до появления этого поля
  metadata[kind] ??= [];

  if (!metadata[kind].includes(methodName)) {
    metadata[kind].push(methodName);
  }

  lifecycleMetadata.set(constructor, metadata);
}

/**
 * Хранилище метаданных хуков: конструктор класса и его метаданные.
 *
 * @internal
 */
export const lifecycleMetadata = new WeakMap<object, LifecycleMetadata>();

/**
 * Помечает метод как хук инициализации.
 *
 * Метод вызывается на фазе INIT в топологическом порядке: зависимости
 * раньше зависимых. Метод должен быть без параметров и возвращать `void`
 * или `Promise<void>`; это проверяет компилятор.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   @OnInit()
 *   async initialize() {
 *     // Захват ресурсов
 *   }
 * }
 * ```
 */
export function OnInit() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    // Декоратор получает сам метод; конструктор класса доступен только
    // из инициализатора, через `this`
    context.addInitializer(function (this) {
      rememberHook(this.constructor, 'onInit', context.name as string);
    });
  };
}

/**
 * Помечает метод как хук старта.
 *
 * Метод вызывается на фазе START: после `@OnInit` всех узлов и после WIRE,
 * но до того, как транспорты начнут принимать запросы. Здесь место работе,
 * которой нужно собранное приложение целиком: планировщики, подписки,
 * потребители очередей. Метод должен быть без параметров и возвращать
 * `void` или `Promise<void>`; это проверяет компилятор.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class Scheduler {
 *   @OnStart()
 *   async start() {
 *     // Граф уже инициализирован целиком
 *   }
 * }
 * ```
 */
export function OnStart() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    context.addInitializer(function (this) {
      rememberHook(this.constructor, 'onStart', context.name as string);
    });
  };
}

/**
 * Помечает метод как хук остановки.
 *
 * Метод вызывается на фазе SHUTDOWN в обратном топологическом порядке:
 * зависимые раньше зависимостей. Метод должен быть без параметров и
 * возвращать `void` или `Promise<void>`; это проверяет компилятор.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   @OnDestroy()
 *   async cleanup() {
 *     // Освобождение ресурсов
 *   }
 * }
 * ```
 */
export function OnDestroy() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    context.addInitializer(function (this) {
      rememberHook(this.constructor, 'onDestroy', context.name as string);
    });
  };
}

/**
 * Возвращает хуки жизненного цикла экземпляра, привязанные к нему.
 *
 * Читает метаданные класса экземпляра и привязывает методы к `instance`.
 *
 * @param instance - Экземпляр провайдера
 * @returns Привязанные хуки
 * @internal
 */
export function getLifecycleHooks(instance: any): LifecycleHooks {
  const { onInit, onStart, onDestroy } =
    lifecycleMetadata.get(instance.constructor) || {};

  return {
    onInit: (onInit || []).map((mname) => resolveHook(instance, mname)),
    onStart: (onStart || []).map((mname) => resolveHook(instance, mname)),
    onDestroy: (onDestroy || []).map((mname) => resolveHook(instance, mname)),
  };
}

/**
 * Находит метод по имени и привязывает его к экземпляру.
 *
 * @param instance - Экземпляр провайдера
 * @param methodName - Имя метода
 * @returns Привязанный хук
 * @throws {TypeError} Если по имени найдена не функция
 * @internal
 */
export function resolveHook(instance: any, methodName: string): Hook {
  const method = instance[methodName];
  if (typeof method !== 'function') {
    throw new TypeError(
      `Method ${methodName} is not a function in ${instance.constructor.name}`,
    );
  }
  return method.bind(instance);
}
