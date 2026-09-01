import {
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
} from './errors.js';
import type { StandardSchemaV1 } from './types.js';

/**
 * Проверяет, что объект реализует Standard Schema v1.
 *
 * Живёт только здесь: `describeForm()` остаётся классификатором формы и
 * вызывается на каждом запросе, платить проверкой на горячем пути незачем.
 *
 * @throws NotAStandardSchemaError если `~standard` нет либо версия не 1
 */
export function assertStandardSchema(
  schema: unknown,
): asserts schema is StandardSchemaV1 {
  const props =
    typeof schema === 'object' && schema !== null && '~standard' in schema
      ? (schema as StandardSchemaV1)['~standard']
      : undefined;

  if (props?.version !== 1) {
    throw new NotAStandardSchemaError(
      'Schema does not implement Standard Schema v1 ' +
        '(no `~standard` property with `version: 1`). ' +
        'Вероятная причина — валидатор старой версии: ' +
        'спеку реализуют zod ≥ 3.24, valibot ≥ 1.0, arktype ≥ 2.0. ' +
        'См. https://standardschema.dev',
    );
  }
}

/**
 * Единственная точка валидации в ядре и транспортах.
 *
 * Через неё проходят `parsePayload`, `parseMetadata`, проверка входа
 * endpoint'а рантаймом пайплайна, поэлементная проверка элементов потока
 * и проверка полей секций конфига — чтобы форма отказа была одна на всех
 * путях.
 *
 * Дом функции — `@common/misc`, а не `@nestling/pipeline`: конфигурация
 * читается и валидируется до существования запроса, и стрелка
 * `@nestling/config → @nestling/pipeline` инвертировала бы порядок фаз.
 * `@nestling/pipeline` реэкспортирует её из прежнего места.
 *
 * @param schema - любая схема, реализующая Standard Schema v1
 * @param value - проверяемое значение
 * @param message - сообщение для {@link SchemaValidationError}
 * @returns выход схемы (`result.value`), то есть результат трансформаций
 * @throws NotAStandardSchemaError если объект не является Standard Schema
 * @throws AsyncSchemaNotSupportedError если `validate` вернул Promise
 * @throws SchemaValidationError если значение не прошло схему
 */
export function validateSync<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  message: string,
): StandardSchemaV1.InferOutput<S> {
  assertStandardSchema(schema);

  const result = schema['~standard'].validate(value);

  if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
    throw new AsyncSchemaNotSupportedError(
      'Schema validation must be synchronous, but `~standard.validate` ' +
        'returned a Promise. Асинхронные refinement’ы в схемах endpoint’ов ' +
        'не поддерживаются: перенесите асинхронную проверку в `.pre`-юнит ' +
        'или в handler.',
    );
  }

  const sync = result as StandardSchemaV1.Result<
    StandardSchemaV1.InferOutput<S>
  >;

  // Спека: falsy `issues` означает успех.
  if (sync.issues) {
    throw new SchemaValidationError(message, normalizeIssues(sync.issues));
  }

  return sync.value;
}
