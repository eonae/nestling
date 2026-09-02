/**
 * Разложение входа: одна конвертация — и разбор по bind-карте.
 *
 * Карта уже отвечает на вопрос «где живёт каждое поле» (её развернул
 * конструктор декларации либо `makeRequest`), поэтому генератору остаётся
 * применить её к **конвертированной** схеме: `parameter` и `requestBody`
 * это две проекции одного значения, а не два независимых описания.
 *
 * Здесь же появляются две диагностики, которых раньше не было нигде:
 * path-параметр, которому нет свойства в схеме, и `bind`-пометка на
 * несуществующем поле. Change `input-bind` отложил их сюда явным образом —
 * до вендор-конвертера структуру схемы узнать было нечем.
 */

import type { ConvertContext } from './schema.js';
import { convertLeaf, readObjectSchema } from './schema.js';
import type {
  JsonValue,
  OpenApiParameter,
  OpenApiRequestBody,
} from './types.js';

import type { HttpBinding, UploadSpec } from '@nestling/contracts';
import { describeForm, isPrimitiveLeaf, mediaTypeOf } from '@nestling/pipeline';

/** Вход операции: параметры и тело */
export interface InputPlan {
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
}

/** Пустой вход: у endpoint'а нет ни параметров, ни тела */
const NOTHING: InputPlan = { parameters: [] };

/** Разобранная структурная часть входа */
interface Decomposed {
  readonly properties: Record<string, JsonValue>;
  readonly required: readonly string[];

  /** Прочие ключи схемы — попадают в тело как есть */
  readonly rest: Record<string, JsonValue>;
}

/**
 * Раскладывает `input` endpoint'а на параметры и тело.
 *
 * @param input - Форма io входа с декларации
 * @param binding - Bind-карта: явные размещения плюс правило для остального
 * @param context - Конвертеры и копилка диагностик
 */
export function planInput(
  input: unknown,
  binding: HttpBinding,
  context: ConvertContext,
): InputPlan {
  const form = describeForm(input);
  const marked = Object.entries(binding.fields);

  // Структурная часть — то, из чего вообще можно что-то вынести. У
  // `multipart` это схема полей, у значения — его лист; у потоковых форм
  // такой части нет: payload не объект.
  const structural = form.kind === 'multipart' ? form.fields : form.leaf;
  const slot = form.kind === 'multipart' ? 'multipart fields' : 'input';

  // Вход описывается формой **как получено по сети**: клиент шлёт то, что
  // схема принимает, а не то, что она отдаёт хендлеру
  const converted = convertLeaf(structural, slot, context, 'input');
  const decomposable =
    form.kind === 'multipart' ||
    (form.kind === 'value' && !isPrimitiveLeaf(form.leaf));
  const object = decomposable ? readObjectSchema(converted) : undefined;

  if (marked.length > 0 && !object) {
    reportUndecomposable(marked, structural, context);
    return NOTHING;
  }

  const taken = new Set<string>();
  const parameters = planParameters(binding, object, taken, context);

  const remaining: Decomposed | undefined = object && {
    properties: Object.fromEntries(
      Object.entries(object.properties).filter(([name]) => !taken.has(name)),
    ),
    required: object.required.filter((name) => !taken.has(name)),
    rest: object.rest,
  };

  const requestBody = planBody(form, input, converted, remaining, binding);

  return requestBody === undefined
    ? { parameters }
    : { parameters, requestBody };
}

/** Диагностика «выносить некуда»: та же ситуация, что ловит `assertBindable` */
function reportUndecomposable(
  marked: readonly [string, unknown][],
  structural: unknown,
  context: ConvertContext,
): void {
  const names = marked.map(([name]) => `'${name}'`).join(', ');

  context.diagnostics.add(
    context.where,
    structural === undefined
      ? `the bind map places ${names} explicitly, but the declaration has ` +
          `no 'input' schema to take them from.`
      : `its 'input' cannot be decomposed: the bind map places ${names} ` +
          `explicitly, but the converted input schema is not an object with ` +
          `'properties'. Declare an object schema for 'input', or drop the ` +
          `placements.`,
  );
}

/**
 * Параметры операции: явные размещения карты плюс правило `rest`.
 *
 * Помеченные вынесенными записываются в `taken` — из тела они вычитаются
 * и из `properties`, и из `required`.
 */
function planParameters(
  binding: HttpBinding,
  object: ReturnType<typeof readObjectSchema>,
  taken: Set<string>,
  context: ConvertContext,
): OpenApiParameter[] {
  const parameters: OpenApiParameter[] = [];

  for (const [name, placement] of Object.entries(binding.fields)) {
    // Явное тело остаётся телом: выносить нечего
    if (placement.in === 'body') {
      continue;
    }

    const property = object?.properties[name];

    if (property === undefined) {
      context.diagnostics.add(
        context.where,
        placement.in === 'path'
          ? `path parameter ':${name}' has no matching property in the ` +
              `converted 'input' schema. Add '${name}' to the input schema, ` +
              `or rename the path segment.`
          : `field '${name}' is marked in 'bind', but the converted 'input' ` +
              `schema has no such property. Fix the name in 'bind', or add ` +
              `the field to the input schema.`,
      );
      continue;
    }

    taken.add(name);

    parameters.push(
      placement.in === 'path'
        ? { name, in: 'path', required: true, schema: property }
        : {
            name,
            in: 'query',
            required: object?.required.includes(name) ?? false,
            style: 'form',
            explode: true,
            schema:
              placement.multiple === true
                ? { type: 'array', items: property }
                : property,
          },
    );
  }

  if (binding.rest !== 'query' || !object) {
    return parameters;
  }

  // Всё неразмещённое у метода без тела попадает в query
  for (const [name, property] of Object.entries(object.properties)) {
    if (taken.has(name) || name in binding.fields) {
      continue;
    }

    taken.add(name);
    parameters.push({
      name,
      in: 'query',
      required: object.required.includes(name),
      style: 'form',
      explode: true,
      schema: property,
    });
  }

  return parameters;
}

/**
 * Тело запроса.
 *
 * Media type берётся штатным `mediaTypeOf` — тем же правилом, которым
 * пользуются транспорт и клиент; собственной таблицы соответствий у
 * генератора нет. Для `stream(T)` схемой контента становится **элемент**:
 * тело это последовательность элементов, и описывать её как единое
 * значение значило бы соврать. `rawBody: true` на media type не влияет —
 * сырые байты это свойство стартового контекста, а не сети.
 */
function planBody(
  form: ReturnType<typeof describeForm>,
  input: unknown,
  converted: JsonValue | undefined,
  remaining: Decomposed | undefined,
  binding: HttpBinding,
): OpenApiRequestBody | undefined {
  const mediaType = mediaTypeOf(input);

  if (form.kind === 'multipart') {
    return body(mediaType, multipartSchema(form.files, remaining));
  }

  if (form.leaf === undefined) {
    return undefined;
  }

  // Потоковая или примитивная форма: раскладывать нечего, тело описывается
  // схемой листа целиком
  if (form.kind !== 'value' || !remaining) {
    return binding.rest === 'query' ? undefined : body(mediaType, converted);
  }

  if (binding.rest === 'query') {
    return undefined;
  }

  // Всё уехало в путь и query — тела не осталось
  if (Object.keys(remaining.properties).length === 0) {
    return undefined;
  }

  return body(mediaType, {
    ...remaining.rest,
    properties: remaining.properties,
    ...(remaining.required.length > 0 ? { required: remaining.required } : {}),
  });
}

/**
 * Схема тела формы `multipart`: поля схемы плюс по свойству на каждый файл.
 *
 * Файл описывается как `type: 'string', format: 'binary'` — так его
 * описывает сама спека OpenAPI; `upload({ multiple: true })` даёт массив
 * таких, а ограничение `mime` попадает в `contentMediaType`.
 */
function multipartSchema(
  files: Readonly<Record<string, UploadSpec>> | undefined,
  remaining: Decomposed | undefined,
): JsonValue {
  const properties: Record<string, JsonValue> = {
    ...remaining?.properties,
  };

  for (const [name, spec] of Object.entries(files ?? {})) {
    const file: Record<string, JsonValue> = {
      type: 'string',
      format: 'binary',
    };

    if (spec.mime && spec.mime.length > 0) {
      // Несколько допустимых типов одним `contentMediaType` не выразимы;
      // перечисление попадает в описание, а не подменяется первым из списка
      file.contentMediaType = spec.mime[0];
      if (spec.mime.length > 1) {
        file.description = `Allowed media types: ${[...spec.mime].join(', ')}`;
      }
    }

    properties[name] = spec.multiple ? { type: 'array', items: file } : file;
  }

  const required = remaining?.required ?? [];

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Оборачивает схему в `content` одного media type */
function body(
  mediaType: string,
  schema: JsonValue | undefined,
): OpenApiRequestBody {
  return {
    required: true,
    content: {
      [mediaType]: schema === undefined ? {} : { schema },
    },
  };
}
