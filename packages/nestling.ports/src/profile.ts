/**
 * Эксплуатационный профиль вызова: бюджет и ключ идемпотентности.
 *
 * Профиль — часть конверта вызова, а не ambient-состояние: он приходит
 * словарём `meta`, передаётся через транспорт относительным timeout'ом и
 * на принимающей стороне доступен двумя каналами, которые не дублируют
 * друг друга:
 *
 * - транспортные атрибуты (`ctx.raw.attributes`) кладут оба вызывателя и
 *   шина безусловно, рядом с `subject`;
 * - ambient-переменные ({@link Deadline}, {@link IdempotencyKey}) — это
 *   проекция для кода произвольной глубины. Её включает штатный pre-юнит,
 *   а присутствие проверяет политика `everyEndpoint(…).hasVar(…)` на
 *   сборке.
 */

import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';
import { contextVar } from '@nestling/pipeline';

/**
 * Атрибут бюджета: абсолютный момент **по часам получателя**.
 *
 * Именно момент, а не остаток: остаток «протухает» на каждом await'е, и
 * юнит, прочитавший его позже транспорта, получил бы неверное число.
 */
export const DEADLINE_ATTRIBUTE = 'deadline';

/** Атрибут ключа идемпотентности команды */
export const IDEMPOTENCY_KEY_ATTRIBUTE = 'idempotencyKey';

/**
 * Строит момент дедлайна на `ms` миллисекунд позже текущего.
 *
 * Существует как сокращённая запись для места вызова: `meta.deadline`
 * принимает только `Date`, а число `500` одинаково правдоподобно читается
 * и как epoch-миллисекунды, и как «через 500 мс». Разница между этими
 * прочтениями — разница между мгновенным отказом и полусекундным
 * бюджетом.
 *
 * @param ms - Бюджет в миллисекундах от текущего момента
 *
 * @example
 * ```typescript
 * await billing.call({ orderId }, { deadline: deadlineIn(500) });
 * ```
 */
export function deadlineIn(ms: number): Date {
  return new Date(Date.now() + ms);
}

/**
 * Возвращает остаток бюджета в миллисекундах или `undefined`, если
 * бюджета нет.
 *
 * Сравниваются только собственные часы с собственными, поэтому рассинхрон
 * часов между процессами на результат не влияет.
 */
export function remainingMs(deadline?: Date): number | undefined {
  return deadline === undefined ? undefined : deadline.getTime() - Date.now();
}

/** Проверяет, исчерпан ли бюджет к этому моменту: вызывать уже нечего */
export function isExhausted(deadline?: Date): boolean {
  const remaining = remainingMs(deadline);

  return remaining !== undefined && remaining <= 0;
}

/**
 * Превращает относительный timeout в момент по часам получателя.
 *
 * Это парная операция к пересчёту бюджета на каждом переходе между
 * процессами: между ними передаётся длительность, а внутри процесса —
 * момент времени.
 */
export function deadlineFromTimeout(timeoutMs?: number): Date | undefined {
  return timeoutMs === undefined ? undefined : new Date(Date.now() + timeoutMs);
}

/**
 * Строит транспортные атрибуты доставленного сообщения: адрес, профиль и
 * провозимый контекст.
 *
 * Одна процедура на оба пути биндинга — поэтому обработчик видит одни и те
 * же атрибуты независимо от того, где живёт вызывающий. Поля, которых в
 * конверте не было, в атрибутах не появляются: `'deadline' in attributes`
 * означает «бюджет был», а не «ключ есть, значение undefined».
 *
 * Провозимые значения ложатся **под своими ключами**, рядом с `subject`:
 * `Var.propagated()` читает их оттуда тем же способом, что `withDeadline()`
 * читает бюджет. Ключи профиля кладутся последними и потому сильнее: их
 * смысл фиксирован ядром, и провозимая переменная с именем `deadline`
 * подменить бюджет не может.
 */
export function profileAttributes(meta: {
  readonly subject: string;
  readonly deadline?: Date;
  readonly idempotencyKey?: string;
  readonly context?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...meta.context,
    subject: meta.subject,
    ...(meta.deadline === undefined
      ? {}
      : { [DEADLINE_ATTRIBUTE]: meta.deadline }),
    ...(meta.idempotencyKey === undefined
      ? {}
      : { [IDEMPOTENCY_KEY_ATTRIBUTE]: meta.idempotencyKey }),
  };
}

/** Сигнал, который никогда не взводится: вызов без `meta.signal` */
const NEVER_ABORTED = new AbortController().signal;

/**
 * Бюджет в полёте: композированный сигнал плюс признак «оборвал именно
 * таймер бюджета».
 */
export interface CallBudget {
  /**
   * Сигнал вызова: композиция таймера бюджета и сигнала вызывающего.
   * Передаётся в контекст обработчика, поэтому кооперативная реализация
   * видит исчерпание бюджета своим `ctx.signal`.
   */
  readonly signal: AbortSignal;

  /**
   * Оборвал вызов **собственный** таймер бюджета, а не вызывающий.
   *
   * Различение по владению таймером, а не по `signal.reason`: `reason`
   * приходит из кода вызывающего и доверенным источником не является.
   */
  readonly expired: boolean;

  /** Снимает таймер: вызов завершён, ждать больше нечего */
  release(): void;
}

/** Бюджета нет — ни таймера, ни композиции: на горячем пути ноль объектов */
function unbounded(signal: AbortSignal): CallBudget {
  return {
    signal,
    expired: false,
    release: () => {
      /* нечего снимать */
    },
  };
}

/**
 * Взводит бюджет вызова.
 *
 * Таймер заводится **только** когда бюджет задан, и снимается `release()`
 * по завершении вызова: вызов без `deadline` не платит ни одним объектом.
 *
 * @param deadline - Абсолютный момент бюджета или `undefined`
 * @param callerSignal - Канал отмены вызывающего (`meta.signal`)
 */
export function startBudget(
  deadline?: Date,
  callerSignal?: AbortSignal,
): CallBudget {
  const caller = callerSignal ?? NEVER_ABORTED;
  const remaining = remainingMs(deadline);

  if (remaining === undefined) {
    return unbounded(caller);
  }

  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), Math.max(0, remaining));

  // Чужой дедлайн не повод держать event loop живым: процесс, которому
  // больше нечего делать, завершается, не дожидаясь истечения бюджета
  timer.unref?.();

  return {
    signal: AbortSignal.any([caller, own.signal]),
    get expired(): boolean {
      // Вызывающий, взведший свой сигнал, «выигрывает»: его отмена
      // остаётся `InternalError`, каким была до появления бюджета
      return own.signal.aborted && !caller.aborted;
    },
    release: () => clearTimeout(timer),
  };
}

/**
 * Бюджет вызова для кода произвольной глубины.
 *
 * Значение — `Date | undefined`, потому что дефолтного бюджета не
 * существует: вызов без `meta.deadline` исполняется без ограничения, и
 * ридер обязан это показывать, а не обещать момент, которого нет.
 *
 * Экспортируется **значением**: политика `everyEndpoint(…).hasVar(Deadline)`
 * адресует именно его, одноимённая переменная из соседнего файла её не
 * удовлетворит.
 *
 * @example
 * ```typescript
 * @Injectable([Ctx(Deadline), ChargeCard.caller])
 * class PlaceOrder {
 *   constructor(
 *     private readonly deadline: CtxReader<Date | undefined>,
 *     private readonly charge: Port<typeof ChargeCard>,
 *   ) {}
 *
 *   // Остаток отдаётся дальше **явно**: бюджет не наследуется, ровно как
 *   // не наследуется `meta.signal`
 *   run(input: Input) {
 *     return this.charge.call(input, { deadline: this.deadline.peek() });
 *   }
 * }
 * ```
 */
export const Deadline = contextVar<Date | undefined>()('deadline');

/**
 * Ключ идемпотентности доставленного сообщения.
 *
 * Значение — всегда строка: на пути порта ключ кладёт вызыватель (переданный
 * либо сгенерированный), а на любом другом транспорте его чеканит сам
 * писатель — ровно как {@link withRequestId} чеканит `requestId`.
 */
export const IdempotencyKey = contextVar<string>()('idempotencyKey');

/**
 * Штатный писатель {@link Deadline}: кладёт бюджет из транспортных
 * атрибутов запроса.
 *
 * @example
 * ```typescript
 * const budgeted = makePipeline().pre(withDeadline());
 * ```
 */
export function withDeadline(): PreUnitFn<
  EmptyInput,
  { deadline: Date | undefined }
> {
  return Deadline.provide((ctx) => {
    const deadline = ctx.raw.attributes[DEADLINE_ATTRIBUTE];

    return deadline instanceof Date ? deadline : undefined;
  });
}

/**
 * Штатный писатель {@link IdempotencyKey}: кладёт ключ из транспортных
 * атрибутов, а при его отсутствии чеканит собственный.
 *
 * Чеканка — не подмена: ключ вызывающего всегда побеждает, а сообщение,
 * пришедшее вовсе без ключа (не с порта, а с произвольного транспорта),
 * идентичности не имеет, и дать её может только получатель.
 */
export function withIdempotencyKey(): PreUnitFn<
  EmptyInput,
  { idempotencyKey: string }
> {
  return IdempotencyKey.provide((ctx) => {
    const key = ctx.raw.attributes[IDEMPOTENCY_KEY_ATTRIBUTE];

    return typeof key === 'string' ? key : crypto.randomUUID();
  });
}
