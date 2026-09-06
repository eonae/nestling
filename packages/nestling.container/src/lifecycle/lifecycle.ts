/**
 * Хук жизненного цикла: функция, принимающая сигнал остановки.
 *
 * Сигнал — тот же, что получают транспорты в `serve`: фоновая работа,
 * начатая в хуке, узнаёт об остановке без обходных путей.
 */
export type Hook = (signal: AbortSignal) => void | Promise<void>;

/** Хуки жизненного цикла одного экземпляра, привязанные к нему. */
export interface LifecycleHooks {
  /**
   * Хуки `@OnStart`: выполняются на фазе START, после INIT всего графа и
   * после WIRE. Хук `@OnStart` видит полностью собранное приложение.
   */
  onStart: Hook[];
}

/** Метаданные хуков класса: имена методов с декоратором `@OnStart`. */
export interface LifecycleMetadata {
  /** Имена методов с `@OnStart` */
  onStart: string[];
}

/** Пустые метаданные */
const emptyMetadata = (): LifecycleMetadata => ({ onStart: [] });

/**
 * Записывает имя декорированного метода в метаданные класса ровно один раз.
 *
 * Инициализатор декоратора выполняется при каждом создании экземпляра,
 * поэтому запись должна быть идемпотентной.
 */
function rememberHook(
  constructor: object,
  kind: keyof LifecycleMetadata,
  methodName: string,
): void {
  const metadata = lifecycleMetadata.get(constructor) || emptyMetadata();

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
const lifecycleMetadata = new WeakMap<object, LifecycleMetadata>();

/**
 * Помечает метод как хук старта — единственный хук жизненного цикла.
 *
 * Метод вызывается на фазе START: после создания всех узлов, захвата всех
 * ресурсов и после WIRE, но до того, как транспорты начнут принимать
 * запросы. Здесь место работе, которой нужно собранное приложение целиком:
 * планировщики, подписки, потребители очередей.
 *
 * Аргументом приходит сигнал остановки — тот же, что получают транспорты.
 * Захват ресурса выражается не хуком, а ролью `@Resource`.
 *
 * @example
 * ```typescript
 * @Component([])
 * class Scheduler {
 *   @OnStart()
 *   async start(signal: AbortSignal) {
 *     // Граф собран целиком, ресурсы захвачены
 *   }
 * }
 * ```
 */
export function OnStart() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    // Декоратор получает сам метод; конструктор класса доступен только
    // из инициализатора, через `this`
    context.addInitializer(function (this) {
      rememberHook(this.constructor, 'onStart', context.name as string);
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
  const { onStart } = lifecycleMetadata.get(instance?.constructor) || {};

  return {
    onStart: (onStart || []).map((mname) => resolveHook(instance, mname)),
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
