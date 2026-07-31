/**
 * Канон размещения HTTP-input и bind-карта.
 *
 * Куда каждое поле `input` кладётся в HTTP-запросе — детерминированная
 * функция `(шаблон пути, метод, пометки) → место`. Результат материализуется
 * **при создании значения** в плоскую карту `HttpBinding`, которая едет на
 * носителе (декларация endpoint'а либо контракт с секцией `http:`) и
 * одинаково читается тремя потребителями: транспортом (сборка payload),
 * генератором OpenAPI (`parameter` vs `requestBody`) и типизированным
 * клиентом (сборка запроса из одного импорта, без сервера).
 *
 * Дом правила — этот пакет, а не транспорт: карту обязан получать клиент,
 * импортирующий контракт без серверного кода. Мест вызова два (конструктор
 * декларации и `makeContract`), реализация канона одна — разъехаться им
 * негде.
 *
 * Карта не перечисляет все поля — перечня ключей у Standard Schema в рантайме
 * нет. Она **тотальна как правило**: у каждого поля есть место — либо явное в
 * `fields` (path-параметры и пометки), либо `rest`.
 */

import { describeForm, isPrimitiveLeaf } from '../io/forms.js';
import type { BindableFields } from '../io/io.js';

/**
 * HTTP-метод — локальный строковый союз.
 *
 * Раньше тип брался из `find-my-way`: маршрутизатор транспорта диктовал
 * форму карты, которую читает браузерный клиент. Здесь перечислены методы
 * HTTP/1.1; экзотику вроде WebDAV контракт не адресует, а транспорту она
 * доступна как прежде — его маршрутизатор принимает свой более широкий
 * союз.
 */
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'TRACE';

/**
 * SSE-специфика ответа: `id`/`event` кадра и период heartbeat.
 *
 * Живёт рядом с картой, а не в транспорте: секция едет тем же носителем,
 * что и размещение полей, и её проверки (`events`-выход, зарезервированное
 * имя `error`) — часть fail-fast создания значения.
 */
export interface SseConfig<T = any> {
  /** Значение поля `id:` кадра; не задано — поле не пишется */
  id?: (item: T) => string | number;

  /** Имя события; не задано — поле не пишется. `error` зарезервировано */
  event?: (item: T) => string;

  /** Период heartbeat-комментариев; не задан — опция транспорта */
  heartbeat?: number;
}

/** Часть HTTP-запроса, в которой живёт поле payload */
export type BindPlace = 'path' | 'query' | 'body';

/** Размещение одного поля */
export interface BindPlacement {
  readonly in: BindPlace;

  /** query-поле всегда массив — в том числе при одном вхождении ключа */
  readonly multiple?: boolean;
}

/**
 * Плоская bind-карта носителя: явные размещения плюс правило для
 * остального.
 */
export interface HttpBinding {
  readonly method: HttpMethod;

  /** Шаблон пути с `:param`-сегментами */
  readonly path: string;

  /** Явные размещения: path-параметры шаблона и помеченные поля */
  readonly fields: Readonly<Record<string, BindPlacement>>;

  /** Куда попадают все остальные поля */
  readonly rest: 'query' | 'body';

  /** Запрошены ли сырые байты тела в стартовом контексте */
  readonly rawBody: boolean;

  /**
   * Секция `sse` — едет тем же носителем, что и размещение полей: это
   * специфика провода, и ядру о ней знать нечего.
   */
  readonly sse?: SseConfig;
}

/**
 * Пометка размещения — **значение**, а не строка.
 *
 * Строковая форма (`bind: { expand: 'query' }`) не принимается намеренно:
 * `query({ multiple: true })` требует опций, а `header('If-Match')` (когда
 * вернётся из deferred) — аргумента. Одна форма записи на все случаи вместо
 * двух; носитель (карта) от формы сахара не зависит.
 */
export interface BindMark {
  /** @internal дискриминант марки: строковая форма записи не принимается */
  readonly __bind: 'http';

  readonly in: Exclude<BindPlace, 'path'>;

  readonly multiple?: boolean;
}

/**
 * Методы без тела запроса.
 *
 * Одна константа обслуживает и правило `rest`, и fail-fast для `body()`:
 * разъехаться им негде.
 */
export const METHODS_WITHOUT_BODY: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'DELETE',
  'OPTIONS',
  'TRACE',
]);

/**
 * Пометка «поле приходит в query-строке».
 *
 * @param options.multiple - поле всегда массив, в том числе при одном
 * вхождении ключа (`?tag=a` → `['a']`)
 *
 * @example
 * ```typescript
 * bind: { expand: query(), tags: query({ multiple: true }) }
 * ```
 */
export function query(options?: { multiple?: boolean }): BindMark {
  return options?.multiple === true
    ? { __bind: 'http', in: 'query', multiple: true }
    : { __bind: 'http', in: 'query' };
}

/**
 * Пометка «поле приходит в теле запроса».
 *
 * Осмысленна для методов без тела она быть не может — такая декларация
 * отвергается при создании.
 */
export function body(): BindMark {
  return { __bind: 'http', in: 'body' };
}

/** Значение создано `query()`/`body()`, а не написано строкой */
export function isBindMark(value: unknown): value is BindMark {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BindMark).__bind === 'http'
  );
}

/**
 * Имена path-параметров шаблона (`:param`-сегментов) — на уровне типов.
 *
 * @example
 * ```typescript
 * PathParams<'/users/:id/orders/:orderId'>  // 'id' | 'orderId'
 * PathParams<'/health'>                     // never
 * ```
 */
export type PathParams<Path extends string> =
  Path extends `${string}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
      ? Name | PathParams<`/${Tail}`>
      : Rest
    : never;

/**
 * Ключи, которые можно пометить в `bind`: поля схемы `input` за вычетом
 * path-параметров шаблона.
 *
 * Рантайм перечня ключей у Standard Schema не получит, но **типы его
 * знают** — этой асимметрией пользуемся: опечатка в имени поля и пометка на
 * path-параметре становятся ошибками компиляции. Непрозрачный `input`
 * (`AnyPayload` без вывода ключей) деградирует до отсутствия подсказок, а
 * не до ошибки: там правила проверяет рантайм.
 *
 * Тип общий для обоих носителей карты — словаря `httpEndpoint` и секции
 * `http:` контракта: правило размещения у них одно.
 */
export type BindMap<Path extends string, I> = [
  Extract<keyof BindableFields<I>, string>,
] extends [never]
  ? Readonly<Record<string, BindMark>>
  : Partial<
      Readonly<
        Record<
          Exclude<Extract<keyof BindableFields<I>, string>, PathParams<Path>>,
          BindMark
        >
      >
    >;

/**
 * Разбирает шаблон пути в список имён path-параметров (в порядке следования).
 */
export function readPathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * Fail-fast шаблона пути в момент создания значения.
 *
 * Проверяется только то, что проверяемо без интроспекции схемы: Standard
 * Schema перечня ключей не отдаёт, поэтому «path-параметр объявлен в
 * шаблоне, но поля с таким именем в схеме нет» не диагностируется —
 * известное ограничение, кандидат на проверку в `@nestling/openapi`, где
 * вендор-конвертер структуру схемы уже знает. Правила размещения (пометки,
 * `rawBody`, неструктурный `input`) проверяет `computeHttpBinding`.
 *
 * @param where - как назвать носителя в тексте ошибки
 */
export function assertHttpPath(
  path: unknown,
  where: string,
): asserts path is string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`${where}: 'path' must be a non-empty string.`);
  }

  if (!path.startsWith('/')) {
    throw new Error(`${where}: 'path' must start with '/', got '${path}'.`);
  }

  const seen = new Set<string>();
  for (const name of readPathParams(path)) {
    if (seen.has(name)) {
      throw new Error(
        `${where}: path parameter ':${name}' is declared twice in '${path}'.`,
      );
    }
    seen.add(name);
  }
}

/** Опции разворачивания канона в карту */
export interface ComputeHttpBindingOptions {
  method: string;

  /** Шаблон пути с `:param`-сегментами */
  path: string;

  /** Пометки «поле → место» из словаря носителя */
  bind?: Readonly<Record<string, BindMark>>;

  /** Сырые байты тела в стартовом контексте */
  rawBody?: boolean;

  /**
   * Конфигурация `input` — нужна только для fail-fast: у потоковой и
   * примитивной форм payload не объект, и класть в него path-параметры и
   * помеченные поля некуда.
   */
  input?: unknown;

  /** Конфигурация `output` — нужна для проверок секции `sse` */
  output?: unknown;

  /** Секция `sse` */
  sse?: SseConfig;

  /**
   * Как назвать носителя в тексте ошибки.
   *
   * Мест вызова два, и владелец дефектной декларации у них разный:
   * `httpEndpoint({ method, path })` у транспорта и `Contract '<имя>'` у
   * контракта. Правило одно, адресат жалобы — нет.
   */
  where?: string;
}

/** Форма `input` с точки зрения размещения полей */
type InputShape = 'absent' | 'structured' | 'unstructured';

/** Бренд карты: отличает нашу карту от постороннего значения в `binding` */
const HTTP_BINDING = Symbol.for('nestling:http:binding');

/** Носитель по умолчанию — когда вызывающий себя не назвал */
function whereOf(options: ComputeHttpBindingOptions): string {
  return (
    options.where ??
    `HTTP binding ({ method: '${options.method}', path: '${options.path}' })`
  );
}

/**
 * Форма `input` с точки зрения размещения полей.
 *
 * `multipart` **структурна**: path-параметры и помеченные query-поля
 * подмешиваются к полям формы (`fields`) до валидации схемой. Потоковые
 * формы неструктурны: payload не объект, и класть в него поля некуда.
 */
function describeInput(input: unknown): {
  shape: InputShape;
  kind: string;
} {
  const form = describeForm(input);

  switch (form.kind) {
    case 'multipart': {
      return { shape: 'structured', kind: 'multipart(...)' };
    }
    case 'stream': {
      return { shape: 'unstructured', kind: 'stream(...)' };
    }
    case 'events': {
      return { shape: 'unstructured', kind: 'events(...)' };
    }
    default: {
      if (form.leaf === undefined) {
        return { shape: 'absent', kind: 'none' };
      }
      return isPrimitiveLeaf(form.leaf)
        ? { shape: 'unstructured', kind: `'${form.leaf}'` }
        : { shape: 'structured', kind: 'schema' };
    }
  }
}

/**
 * Fail-fast словаря: ровно то, что решаемо без интроспекции схемы.
 *
 * Проверка «path-параметр объявлен в шаблоне, но поля с таким именем в схеме
 * нет» в общем виде недостижима — Standard Schema перечня ключей не отдаёт.
 * Реализуется её решаемая часть: случаи, когда параметру или помеченному
 * полю физически негде оказаться.
 */
function assertBindable(options: ComputeHttpBindingOptions): void {
  const { method, path, bind, rawBody = false, input } = options;
  const where = whereOf(options);

  const pathParams = readPathParams(path);
  const marks = Object.entries(bind ?? {});
  const { shape, kind } = describeInput(input);
  const bodyless = METHODS_WITHOUT_BODY.has(method.toUpperCase());

  for (const [name, mark] of marks) {
    if (!isBindMark(mark)) {
      throw new TypeError(
        `${where}: 'bind.${name}' must be a mark created by query() or ` +
          `body(); the string form is not accepted.`,
      );
    }

    if (pathParams.includes(name)) {
      throw new Error(
        `${where}: field '${name}' is the path parameter ':${name}' and ` +
          `cannot be re-bound — drop it from 'bind'.`,
      );
    }

    if (mark.in === 'body' && bodyless) {
      throw new Error(
        `${where}: field '${name}' is bound to the body, but '${method}' ` +
          `has no request body.`,
      );
    }
  }

  if (marks.length > 0 && shape === 'unstructured') {
    throw new Error(
      `${where}: 'bind' is not applicable to a non-structural input ` +
        `(${kind}) — there is no payload object to place fields into.`,
    );
  }

  if (pathParams.length > 0 && shape !== 'structured') {
    const [name] = pathParams;
    throw new Error(
      shape === 'absent'
        ? `${where}: path parameter ':${name}' has nowhere to go — the ` +
          `declaration has no 'input'.`
        : `${where}: path parameter ':${name}' has nowhere to go — 'input' ` +
          `is non-structural (${kind}).`,
    );
  }

  if (rawBody && (shape === 'unstructured' || kind === 'multipart(...)')) {
    throw new Error(
      `${where}: 'rawBody: true' is not compatible with ${kind} input — ` +
        `the request body is consumed by the parser.`,
    );
  }
}

/**
 * Зонд для `sse.event`: элемента на момент создания значения ещё нет.
 *
 * Отдельная константа, а не литерал в аргументе, — иначе автофиксер
 * вычищает «бесполезный undefined» и ломает зонд.
 */
const NO_ITEM = undefined as never;

/**
 * Fail-fast секции `sse`.
 *
 * Имя события `error` зарезервировано за mid-stream отказом. Проверить
 * функцию в общем виде нельзя — она считает имя от элемента, — поэтому
 * зондируем её безопасно: константа `() => 'error'` отвечает и на
 * `undefined`, а `e => e.kind` на нём бросает, и это не наше дело.
 * Вторая линия обороны — проверка при сборке кадра.
 */
function assertSse(options: ComputeHttpBindingOptions): void {
  const { sse, output } = options;
  if (!sse) {
    return;
  }

  const where = whereOf(options);

  if (describeForm(output).kind !== 'events') {
    throw new Error(
      `${where}: 'sse' is only meaningful for an events(...) output — the ` +
        `section describes SSE frames.`,
    );
  }

  if (sse.event) {
    let probed: unknown;
    try {
      probed = sse.event(NO_ITEM);
    } catch {
      // Имя считается от элемента — на зонде это нормально
      return;
    }

    if (probed === 'error') {
      throw new Error(
        `${where}: SSE event name 'error' is reserved for mid-stream ` +
          `failures — pick another name in 'sse.event'.`,
      );
    }
  }
}

/**
 * Собирает карту без проверок (канон полностью определён аргументами).
 *
 * Публична ради одного потребителя — фолбэка транспорта для декларации,
 * созданной kernel-примитивом `makeEndpoint` без карты. Fail-fast там
 * неуместен: он дело конструктора у владельца декларации, а на горячем пути
 * приёма запроса канон уже полностью определён парой (метод, путь).
 */
export function buildHttpBinding(
  options: ComputeHttpBindingOptions,
): HttpBinding {
  const { method, path, bind, rawBody = false, sse } = options;

  const fields: Record<string, BindPlacement> = {};

  // Path-параметры шаблона — первыми: пометка на них отвергнута выше
  for (const name of readPathParams(path)) {
    fields[name] = Object.freeze({ in: 'path' as const });
  }

  for (const [name, mark] of Object.entries(bind ?? {})) {
    fields[name] = Object.freeze(
      mark.multiple === true
        ? { in: mark.in, multiple: true }
        : { in: mark.in },
    );
  }

  const binding: HttpBinding = {
    method: method.toUpperCase() as HttpMethod,
    path,
    fields: Object.freeze(fields),
    rest: METHODS_WITHOUT_BODY.has(method.toUpperCase()) ? 'query' : 'body',
    rawBody: Boolean(rawBody),
    ...(sse === undefined ? {} : { sse: Object.freeze({ ...sse }) }),
  };

  Object.defineProperty(binding, HTTP_BINDING, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(binding);
}

/**
 * Разворачивает канон и пометки в плоскую bind-карту.
 *
 * Вызывается в момент создания значения — конструктором декларации
 * (`httpEndpoint`) либо `makeContract` — а не при регистрации в приложении:
 * карту обязан получать клиент, импортирующий контракт без серверного кода,
 * а fail-fast обязан срабатывать у владельца декларации.
 *
 * @throws {Error} Нарушение правила размещения (см. `assertBindable`)
 */
export function computeHttpBinding(
  options: ComputeHttpBindingOptions,
): HttpBinding {
  assertBindable(options);
  assertSse(options);
  return buildHttpBinding(options);
}

/** Значение — bind-карта, а не посторонний объект в поле `binding` */
export function isHttpBinding(value: unknown): value is HttpBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[HTTP_BINDING] === true
  );
}
