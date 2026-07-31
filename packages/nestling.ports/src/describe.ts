/**
 * Дескриптор контракта — контракт, переведённый в JSON-значение.
 *
 * Всё, кроме листовых схем, ядро знает и так: вид контракта, дерево форм
 * io (`describeForm`), коды и статусы объявленных отказов. Листья
 * непрозрачны — Standard Schema интроспекции не даёт, — поэтому лист либо
 * переводится в JSON Schema вендор-конвертером, либо честно помечается
 * непрозрачным. «Схемы нет» и «схема есть, но не сконвертирована» —
 * **разные** пометки: молчание на непонятом узле это ровно тот режим,
 * ради выхода из которого затевается дифф.
 *
 * Дескриптор целиком сериализуем: ни функций, ни символов, ни ссылок на
 * значения-схемы. Это не деталь реализации, а требование — снапшот
 * лежит в репозитории и читается диффом чужого прогона.
 */

import type { AnyContract, ContractKind } from './contract.js';
import type { BusBindingBearer } from './transport.js';
import { busBindingOf } from './transport.js';

import type {
  FormKind,
  SchemaDocConverter,
  UploadSpec,
} from '@nestling/pipeline';
import {
  assertConverters,
  describeForm,
  isPrimitiveLeaf,
  pickConverter,
  schemaVendorOf,
} from '@nestling/pipeline';

/** JSON-значение: всё, что переживает `JSON.parse(JSON.stringify(...))` */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Дескриптор листа формы — четыре взаимоисключающих исхода.
 *
 * `opaque` и `none` разведены намеренно: первое означает «схема есть,
 * конвертера для её вендора нет», второе — «листа не объявлено». Дифф
 * относится к ним по-разному: первое даёт `unknown`, второе сравнивается
 * структурно.
 */
export type SchemaDescriptor =
  /** Листа нет: `input`/`output` не объявлены */
  | { readonly leaf: 'none' }
  /** Примитивный лист: тело как есть */
  | { readonly leaf: 'primitive'; readonly primitive: 'binary' | 'text' }
  /** Схема, переведённая конвертером своего вендора */
  | {
      readonly leaf: 'schema';
      readonly vendor: string;
      readonly jsonSchema: JsonValue;
    }
  /** Схема известного вендора, для которого конвертера не передали */
  | { readonly leaf: 'opaque'; readonly vendor: string };

/** Файловое поле формы `multipart` с его ограничениями */
export interface FileFieldDescriptor {
  /** Поле принимает несколько файлов */
  readonly multiple: boolean;

  /** Лимит размера файла, если объявлен */
  readonly maxSize?: number;

  /** Допустимые MIME-типы, если объявлены */
  readonly mime?: readonly string[];
}

/** Дескриптор одной формы io: вид, лист и — для `multipart` — поля */
export interface FormDescriptorValue {
  /** Вид формы: `value` | `stream` | `events` | `multipart` */
  readonly kind: FormKind;

  /** Лист формы */
  readonly leaf: SchemaDescriptor;

  /** Схема полей формы (`multipart`) */
  readonly fields?: SchemaDescriptor;

  /** Файловые поля по именам, отсортированные по имени (`multipart`) */
  readonly files?: Readonly<Record<string, FileFieldDescriptor>>;
}

/** Объявленный отказ в дескрипторе: код и его статус */
export interface FailDescriptor {
  /** Машинный код — идентичность отказа */
  readonly code: string;

  /** Транспортно-нейтральный статус ответа */
  readonly status: string;
}

/** Контракт как значение снапшота */
export interface ContractDescriptor {
  /** Имя-адрес контракта; версия — часть имени */
  readonly name: string;

  readonly kind: ContractKind;

  readonly input: FormDescriptorValue;

  readonly output: FormDescriptorValue;

  /** Объявленные отказы, отсортированные по коду */
  readonly errors: readonly FailDescriptor[];
}

/** Опции описания: конвертеры схем — данные вызывающего */
export interface DescribeOptions {
  /**
   * Конвертеры листовых схем. Отсутствие конвертера для вендора — не
   * ошибка: лист помечается непрозрачным, а решение о строгости
   * принимает потребитель дескриптора.
   */
  readonly converters?: readonly SchemaDocConverter[];
}

/** Источник дескриптора: контракт или несущая его декларация-реализация */
export type DescribeSource = AnyContract | BusBindingBearer;

// ---------------------------------------------------------------------------
// Канонизация JSON
// ---------------------------------------------------------------------------

/**
 * Приводит результат конвертера к каноническому JSON-значению.
 *
 * Ключи объектов сортируются, `undefined` и функции выпадают: снапшот
 * обязан быть побайтово одинаковым на двух прогонах, а порядок ключей в
 * выводе конвертера ничем не гарантирован.
 */
export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  switch (typeof value) {
    case 'boolean':
    case 'string': {
      return value;
    }
    case 'number': {
      return Number.isFinite(value) ? value : null;
    }
    case 'object': {
      const source = value as Record<string, unknown>;
      const result: Record<string, JsonValue> = {};

      for (const key of Object.keys(source).sort()) {
        const item = source[key];
        if (item === undefined || typeof item === 'function') {
          continue;
        }
        result[key] = canonicalizeJson(item);
      }

      return result;
    }
    default: {
      // Функции, символы и `bigint` в JSON Schema не появляются; молчаливо
      // выбросить их значило бы соврать, поэтому конвертируем в null
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Описание листа и формы
// ---------------------------------------------------------------------------

const NO_LEAF: SchemaDescriptor = Object.freeze({ leaf: 'none' as const });

/** Описывает лист формы: примитив, JSON Schema, непрозрачность или ничего */
function describeLeaf(
  leaf: unknown,
  converters: readonly SchemaDocConverter[] | undefined,
): SchemaDescriptor {
  if (leaf === undefined || leaf === null) {
    return NO_LEAF;
  }

  if (isPrimitiveLeaf(leaf)) {
    return { leaf: 'primitive', primitive: leaf };
  }

  const vendor = schemaVendorOf(leaf);

  if (vendor === undefined) {
    // Не Standard Schema и не примитив: описывать в этом значении нечего,
    // и делать вид, что схема есть, — хуже, чем сказать «листа нет»
    return NO_LEAF;
  }

  const converter = pickConverter(converters, leaf);

  if (!converter) {
    return { leaf: 'opaque', vendor };
  }

  return {
    leaf: 'schema',
    vendor,
    jsonSchema: canonicalizeJson(converter.toJsonSchema(leaf as never)),
  };
}

/** Описывает файловое поле `multipart`, сохраняя только его ограничения */
function describeFile(spec: UploadSpec): FileFieldDescriptor {
  return {
    multiple: spec.multiple,
    ...(spec.maxSize === undefined ? {} : { maxSize: spec.maxSize }),
    ...(spec.mime === undefined ? {} : { mime: [...spec.mime].sort() }),
  };
}

/**
 * Описывает форму io значением.
 *
 * Вид формы читается штатным описателем (`describeForm`), а не разбором
 * значения по месту: правило «что считается формой» одно на транспорт,
 * документацию и снапшот.
 */
export function describeFormValue(
  io: unknown,
  options: DescribeOptions = {},
): FormDescriptorValue {
  const form = describeForm(io);
  const { converters } = options;

  const value: FormDescriptorValue = {
    kind: form.kind,
    leaf: describeLeaf(form.leaf, converters),
  };

  if (form.kind !== 'multipart') {
    return value;
  }

  const files: Record<string, FileFieldDescriptor> = {};
  for (const name of Object.keys(form.files ?? {}).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    files[name] = describeFile(form.files![name]);
  }

  return {
    ...value,
    fields: describeLeaf(form.fields, converters),
    files,
  };
}

// ---------------------------------------------------------------------------
// Описание контракта
// ---------------------------------------------------------------------------

/** Интерфейс операции, прочитанный с контракта или с его реализации */
interface ContractShape {
  readonly name: string;
  readonly kind: ContractKind;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errors?: readonly { code: string; status: string }[];
}

/**
 * Приводит источник к интерфейсу операции.
 *
 * Декларация-реализация несёт имя и вид не полями, а bus-биндингом:
 * `implement` копирует туда `subject`/`kind` контракта, и это тот же
 * источник истины, которым пользуется топология портов.
 */
function readShape(source: DescribeSource): ContractShape {
  const binding = busBindingOf(source as BusBindingBearer);

  const record = source as unknown as {
    name?: unknown;
    kind?: unknown;
    input?: unknown;
    output?: unknown;
    errors?: readonly { code: string; status: string }[];
  };

  if (binding) {
    return {
      name: binding.subject,
      kind: binding.kind,
      input: record.input,
      output: record.output,
      errors: record.errors,
    };
  }

  if (typeof record.name !== 'string' || typeof record.kind !== 'string') {
    throw new TypeError(
      `describeContract(...): expected a contract value created by ` +
        `makeContract(), or an implementation declaration created by ` +
        `implement() — the argument carries neither a name/kind pair nor a ` +
        `bus binding.`,
    );
  }

  return {
    name: record.name,
    kind: record.kind as ContractKind,
    input: record.input,
    output: record.output,
    errors: record.errors,
  };
}

/**
 * Описывает контракт значением.
 *
 * @param source - Контракт (`makeContract`) или его реализация (`implement`)
 * @param options - Конвертеры листовых схем; без них листья непрозрачны
 * @returns JSON-сериализуемый дескриптор
 * @throws {Error} Источник не контракт и не реализация; два конвертера
 * одного вендора в списке
 *
 * @example
 * ```typescript
 * const descriptor = describeContract(ChargeCard, {
 *   converters: [zodConverter()],
 * });
 * // { name: 'billing.charge', kind: 'request', input: { … }, … }
 * ```
 */
export function describeContract(
  source: DescribeSource,
  options: DescribeOptions = {},
): ContractDescriptor {
  assertConverters(options.converters);

  const shape = readShape(source);

  const errors = [...(shape.errors ?? [])]
    .map((definition) => ({
      code: definition.code,
      status: definition.status,
    }))
    .sort((left, right) => (left.code < right.code ? -1 : 1));

  return {
    name: shape.name,
    kind: shape.kind,
    input: describeFormValue(shape.input, options),
    output: describeFormValue(shape.output, options),
    errors,
  };
}
