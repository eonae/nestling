/**
 * Реестр активных подписок — обычный singleton графа.
 *
 * Реестр **отражает** факт, а не опережает его: запись появляется, когда
 * слой позвал `open`, и снимается, когда пайплайн исполнил `.finally`.
 * Поэтому `abort()` только взводит сигнал — снятие случится обычным
 * путём, тем же, что и при дисконнекте клиента.
 */

import type {
  SubscriptionClosed,
  SubscriptionClosedFact,
  SubscriptionOpened,
  SubscriptionOpenedFact,
} from './contracts.js';
import { SubscriptionKilledError } from './errors.js';
import type {
  CloseReason,
  SubscriptionEvent,
  SubscriptionFilter,
  SubscriptionInfo,
  SubscriptionKind,
  TrackedSubscription,
} from './types.js';
import { kindOfOutput } from './types.js';

import { OnDestroy } from '@nestling/container';
import type { Emitter } from '@nestling/contracts';
import type { AnyInput, ExtendableContext, Outcome } from '@nestling/pipeline';
import { Topic } from '@nestling/streams';

/** Контекст запроса в терминах реестра: конкретный input ему безразличен */
export type SubscriptionContext = ExtendableContext<AnyInput>;

/** Извлекает подписанта из контекста запроса */
export type IdentityExtractor = (
  ctx: SubscriptionContext,
) => string | undefined;

/** Извлекает метки подписки из контекста запроса */
export type LabelsExtractor = (
  ctx: SubscriptionContext,
) => Record<string, string>;

/** Опции, которые нужны самому реестру (модуль добавляет к ним `publish`) */
export interface RegistryOptions {
  /** Кто подписан: экстрактор решает композиция, реестр только зовёт */
  readonly identity?: IdentityExtractor;

  /** Метки подписки — тот же принцип, что у `identity` */
  readonly labels?: LabelsExtractor;

  /** Буфер ленты на одного наблюдателя; политика — `drop-oldest` */
  readonly feedBuffer?: number;

  /** Имя узла в фактах: наблюдение кластерное, управление — нет */
  readonly node?: string;

  /**
   * Наблюдатель отказов публикации.
   *
   * Факт наблюдения не должен ронять подписку, поэтому ошибка `emit`
   * гасится. Молча терять её тоже нельзя — она уходит сюда.
   */
  readonly onPublishError?: (error: unknown, event: SubscriptionEvent) => void;
}

/** Буфер ленты по умолчанию: наблюдателю с запасом, но не безразмерно */
const DEFAULT_FEED_BUFFER = 256;

/**
 * Внутренняя запись: живой контекст и административный контроллер.
 *
 * Наружу не передаётся ни то ни другое — только снимок.
 */
interface Entry {
  readonly ctx: SubscriptionContext;
  readonly controller: AbortController;
  readonly transport: string;
  readonly pattern: string;
  readonly kind: SubscriptionKind;
  readonly identity?: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly startedAt: number;
}

/** Подписка подходит под фильтр: точное совпадение и подмножество меток */
function matches(entry: Entry, filter?: SubscriptionFilter): boolean {
  if (!filter) {
    return true;
  }

  if (filter.transport !== undefined && filter.transport !== entry.transport) {
    return false;
  }

  if (filter.pattern !== undefined && filter.pattern !== entry.pattern) {
    return false;
  }

  if (filter.identity !== undefined && filter.identity !== entry.identity) {
    return false;
  }

  for (const [key, value] of Object.entries(filter.labels ?? {})) {
    if (entry.labels[key] !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Реестр подписок: список, принудительное завершение и лента изменений.
 *
 * Node-local по построению: `list()` и `abort()` действуют на подписки
 * своего процесса. Кластерным является **наблюдение** (факты операциями),
 * а не управление — шина V1 не даёт ни scatter-gather, ни широковещательной
 * подписки без queue-group.
 *
 * @example
 * ```typescript
 * const active = registry.list({ pattern: 'GET /api/users/activity' });
 * registry.abort(active[0].id, 'освобождаем узел под деплой');
 * ```
 */
export class SubscriptionRegistry {
  readonly #entries = new Map<string, Entry>();

  readonly #feed: Topic<SubscriptionEvent>;

  readonly #options: RegistryOptions;

  readonly #openedEmitter?: Emitter<typeof SubscriptionOpened>;

  readonly #closedEmitter?: Emitter<typeof SubscriptionClosed>;

  /**
   * Хвост цепочки публикаций.
   *
   * Публикация не блокирует ни открытие, ни закрытие подписки (факт
   * наблюдения — не часть горячего пути), но и не перемешивается: цепочка
   * сохраняет тот же порядок, в котором факты случились.
   */
  #publishing: Promise<void> = Promise.resolve();

  /**
   * @param options - Решения композиции; поставляет фабрика модуля
   * @param openedEmitter - Вызыватель `subscriptions.opened`; отсутствует,
   * когда публикация выключена — тогда в графе нет и самого узла
   * @param closedEmitter - Вызыватель `subscriptions.closed`
   */
  constructor(
    options: RegistryOptions = {},
    openedEmitter?: Emitter<typeof SubscriptionOpened>,
    closedEmitter?: Emitter<typeof SubscriptionClosed>,
  ) {
    this.#options = options;
    this.#feed = new Topic<SubscriptionEvent>({
      buffer: options.feedBuffer ?? DEFAULT_FEED_BUFFER,
      onSlowConsumer: 'drop-oldest',
    });
    this.#openedEmitter = openedEmitter;
    this.#closedEmitter = closedEmitter;
  }

  /** Число активных подписок в этом процессе */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Снимки активных подписок — новые значения на каждый вызов.
   *
   * @param filter - Точное совпадение по `transport`/`pattern`/`identity`
   * и подмножество `labels`
   */
  list(filter?: SubscriptionFilter): readonly SubscriptionInfo[] {
    const found: SubscriptionInfo[] = [];

    for (const [id, entry] of this.#entries) {
      if (matches(entry, filter)) {
        found.push(snapshot(id, entry));
      }
    }

    return found;
  }

  /** Снимок одной подписки или `undefined`, если её нет */
  get(id: string): SubscriptionInfo | undefined {
    const entry = this.#entries.get(id);

    return entry ? snapshot(id, entry) : undefined;
  }

  /**
   * Административное завершение подписки.
   *
   * Взводит **свой** контроллер, а не сигнал запроса: `meta.signal`
   * остаётся сигналом запроса, и наблюдатели ядра его состояние не путают.
   * Запись здесь не снимается — её снимет `.finally`, когда поток
   * действительно закончится.
   *
   * @returns Была ли такая подписка
   */
  abort(id: string, reason?: string): boolean {
    const entry = this.#entries.get(id);

    if (!entry) {
      return false;
    }

    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new SubscriptionKilledError(id, reason));
    }

    return true;
  }

  /**
   * То же для всех подходящих под фильтр.
   *
   * @returns Сколько подписок завершено
   */
  abortAll(filter?: SubscriptionFilter, reason?: string): number {
    let killed = 0;

    for (const [id, entry] of this.#entries) {
      if (matches(entry, filter)) {
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(new SubscriptionKilledError(id, reason));
        }
        killed += 1;
      }
    }

    return killed;
  }

  /**
   * Лента изменений реестра.
   *
   * Наблюдатель, который не успевает читать, теряет события по
   * `drop-oldest` — регистрация подписок из-за него не замедляется.
   *
   * @param signal - Завершает итерацию; без него лента живёт до `close()`
   * реестра (SHUTDOWN)
   */
  watch(signal?: AbortSignal): AsyncIterableIterator<SubscriptionEvent> {
    return this.#feed.subscribe(signal);
  }

  /**
   * Регистрирует подписку. Точка входа слоя `tracked`, не пользовательская.
   *
   * @internal
   */
  open(ctx: SubscriptionContext): TrackedSubscription {
    const id = crypto.randomUUID();
    const controller = new AbortController();

    const entry: Entry = {
      ctx,
      controller,
      transport: ctx.endpoint.transport,
      pattern: ctx.endpoint.pattern,
      kind: kindOfOutput(ctx.endpoint),
      identity: this.#options.identity?.(ctx),
      labels: Object.freeze({ ...this.#options.labels?.(ctx) }),
      startedAt: Date.now(),
    };

    this.#entries.set(id, entry);

    const info = snapshot(id, entry);
    const event: SubscriptionEvent = { type: 'opened', info };

    // Лента — до вызова хендлера: собственного `opened` endpoint живого
    // просмотра поэтому не увидит, а чужие увидит
    this.#feed.push(event);
    this.#publish(event, () =>
      this.#openedEmitter?.emit({
        node: this.#options.node,
        id: info.id,
        transport: info.transport,
        pattern: info.pattern,
        kind: info.kind,
        identity: info.identity,
        startedAt: info.startedAt,
      } satisfies SubscriptionOpenedFact),
    );

    return {
      id,
      // Один сигнал на три причины отмены: дисконнект, shutdown, kill
      signal: AbortSignal.any([ctx.signal, controller.signal]),
    };
  }

  /**
   * Снимает подписку. Точка выхода слоя `tracked`, не пользовательская.
   *
   * @internal
   */
  close(id: string, outcome: Outcome): void {
    const entry = this.#entries.get(id);

    if (!entry) {
      return;
    }

    // Пайплайн административного завершения не видит: его `computeOutcome`
    // смотрит на сигнал запроса, а взведён был наш контроллер
    const reason: CloseReason = entry.controller.signal.aborted
      ? 'killed'
      : outcome;

    const info = snapshot(id, entry);
    const event: SubscriptionEvent = { type: 'closed', info, reason };

    this.#feed.push(event);
    this.#entries.delete(id);

    // Взвод собственного контроллера отвязывает композитный сигнал от
    // (долгоживущего) сигнала запроса детерминированно, а не по факту
    // сборки мусора. Причины у него нет: подписка уже закончилась, и
    // выдавать её завершение за административное было бы враньём
    if (!entry.controller.signal.aborted) {
      entry.controller.abort();
    }

    this.#publish(event, () =>
      this.#closedEmitter?.emit({
        node: this.#options.node,
        id: info.id,
        reason,
        itemsOut: info.itemsOut,
        closedAt: Date.now(),
      } satisfies SubscriptionClosedFact),
    );
  }

  /**
   * SHUTDOWN: лента закрывается, наблюдатели завершаются нормально.
   *
   * Записи снимать здесь не нужно и нечем: сигнал приложения взведён,
   * потоковые ответы завершаются, и каждый снимает свою запись сам.
   */
  @OnDestroy()
  dispose(): void {
    this.#feed.close();
  }

  /** Ставит публикацию факта в очередь, гася её отказ */
  #publish(event: SubscriptionEvent, emit: () => Promise<void> | undefined) {
    if (!this.#openedEmitter && !this.#closedEmitter) {
      return;
    }

    this.#publishing = this.#publishing.then(
      async () => {
        try {
          await emit();
        } catch (error) {
          this.#options.onPublishError?.(error, event);
        }
      },
      // Отказ предыдущего звена уже ушёл в хук — цепочку он не рвёт
      (): void => undefined,
    );
  }
}

/**
 * Снимок записи — новое замороженное значение.
 *
 * `itemsOut` читается из `ctx.summary` в момент вызова: сам `summary`
 * мутируется рантаймом, поэтому наружу передаётся число, а не ссылка.
 */
function snapshot(id: string, entry: Entry): SubscriptionInfo {
  return Object.freeze({
    id,
    transport: entry.transport,
    pattern: entry.pattern,
    kind: entry.kind,
    identity: entry.identity,
    labels: entry.labels,
    startedAt: entry.startedAt,
    itemsOut: entry.ctx.summary.itemsOut,
  });
}
