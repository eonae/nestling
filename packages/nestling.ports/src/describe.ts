/**
 * Дескриптор операции: операция, переведённый в JSON-значение.
 *
 * Всё, кроме листовых схем, ядро знает и так: вид операции, дерево форм
 * io (`describeForm`), коды и статусы объявленных отказов. Схема листа
 * непрозрачна для интроспекции Standard Schema, поэтому лист либо
 * переводится в JSON Schema вендор-конвертером, либо помечается
 * непрозрачным.
 *
 * Пометки «схемы нет» и «схема есть, но не сконвертирована» различаются:
 * непонятый узел не должен выглядеть так же, как отсутствующий, иначе
 * снапшот перестанет замечать реальные изменения схемы.
 *
 * Дескриптор целиком сериализуем: в нём нет функций, символов и ссылок
 * на значения схем. Снапшот дескриптора хранится в репозитории и
 * сравнивается диффом с чужим прогоном, поэтому это требование, а не
 * деталь реализации.
 */

import type { BusBindingBearer } from './transport.js';
import { busBindingOf } from './transport.js';

import type { AnyOperation, OperationKind } from '@nestling/contracts';
import type {
  FormKind,
  SchemaDocConverter,
  UploadSpec,
} from '@nestling/pipeline';
import {
  assertConverters,
  describeForm,
  isPrimitiveLeaf,
  leafJsonSchema,
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
  /**
   * Схема, переведённая конвертером своего вендора — либо объявленная
   * аннотацией `jsonSchema(schema, json)` рядом с самой схемой
   */
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

/** Дескриптор одной формы io: вид, лист и поля для `multipart` */
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

/** Операция как значение снапшота */
export interface OperationDescriptor {
  /** Имя-адрес операции; версия — часть имени */
  readonly name: string;

  readonly kind: OperationKind;

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

/** Источник дескриптора: операция или его реализация (`implement`) */
export type DescribeSource = AnyOperation | BusBindingBearer;

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

  // Порядок проверки: аннотация, затем конвертер, затем «конвертера нет».
  // Аннотированный лист непрозрачным не считается независимо от списка
  // конвертеров: `jsonSchema(...)` и есть ответ на вопрос «как выглядит эта
  // схема», и помечать его непрозрачным значило бы терять уже данный ответ.
  const resolved = leafJsonSchema(converters, leaf);

  if (!resolved || resolved.outcome === 'unconvertible') {
    return { leaf: 'opaque', vendor };
  }

  return {
    leaf: 'schema',
    vendor: resolved.vendor,
    jsonSchema: canonicalizeJson(resolved.json),
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
// Описание операции
// ---------------------------------------------------------------------------

/** Интерфейс операции, прочитанный с операции или с его реализации */
interface ContractShape {
  readonly name: string;
  readonly kind: OperationKind;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errors?: readonly { code: string; status: string }[];
}

/**
 * Приводит источник к интерфейсу операции.
 *
 * Декларация-реализация несёт имя и вид не полями, а bus-биндингом:
 * `implement` копирует туда `subject`/`kind` операции, и это тот же
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
      `describeOperation(...): expected a contract value created by ` +
        `makeRequest(), or an implementation declaration created by ` +
        `implement() — the argument carries neither a name/kind pair nor a ` +
        `bus binding.`,
    );
  }

  return {
    name: record.name,
    kind: record.kind as OperationKind,
    input: record.input,
    output: record.output,
    errors: record.errors,
  };
}

/**
 * Описывает операция значением.
 *
 * @param source - Операция (`makeRequest`) или его реализация (`implement`)
 * @param options - Конвертеры листовых схем; без них листья непрозрачны
 * @returns JSON-сериализуемый дескриптор
 * @throws {Error} Источник не операция и не реализация; два конвертера
 * одного вендора в списке
 *
 * @example
 * ```typescript
 * const descriptor = describeOperation(ChargeCard, {
 *   converters: [zodConverter()],
 * });
 * // { name: 'billing.charge', kind: 'request', input: { … }, … }
 * ```
 */
export function describeOperation(
  source: DescribeSource,
  options: DescribeOptions = {},
): OperationDescriptor {
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
