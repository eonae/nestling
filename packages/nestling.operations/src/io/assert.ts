/**
 * Проверка форм io при создании декларации.
 *
 * Проверяется то, что известно без сборки приложения и без списка ключей
 * схемы: слот, вид формы и шаги цепочки, меняющие тип. Совпадение имени
 * файлового поля с полем `fields` проверяют типы (`NoFieldConflict`).
 *
 * Соответствие форм возможностям транспорта проверяется при сборке
 * приложения (`assertFormsSupported`).
 */

import type { ChainStep, FormDescriptor } from './forms.js';
import { describeForm, isForm, isStreamKind, isUploadSpec } from './forms.js';

/** Слот декларации, в котором объявлена форма */
export type FormSlot = 'input' | 'output';

/** Человекочитаемое имя формы для текста ошибки */
export function nameOfForm(io: unknown): string {
  if (isUploadSpec(io)) {
    return 'upload()';
  }
  if (io === 'binary' || io === 'text') {
    return `'${io}'`;
  }
  if (!isForm(io)) {
    return 'a schema value';
  }

  switch (io.kind) {
    case 'stream': {
      return 'stream(...)';
    }
    case 'events': {
      return 'events(...)';
    }
    case 'multipart': {
      return 'multipart(...)';
    }
    default: {
      return 'a schema value';
    }
  }
}

/**
 * Находит шаг цепочки, который меняет тип элемента.
 *
 * `through` не считается: сохраняет ли он тип, известно только типам, а
 * вариант без смены типа допустим.
 */
function typeChangingStep(chain: readonly ChainStep[]): ChainStep | undefined {
  return chain.find((step) => step.op === 'batch');
}

function assertSlot(
  pattern: string,
  slot: FormSlot,
  io: unknown,
  form: FormDescriptor,
): void {
  const where = `Endpoint '${pattern}'`;

  if (isUploadSpec(io)) {
    throw new TypeError(
      `${where}: 'upload()' in '${slot}' is not a form — it is a file field ` +
        `specification and is only valid inside multipart({ files: … }).`,
    );
  }

  if (isStreamKind(form.kind) && form.leaf === undefined) {
    throw new TypeError(
      `${where}: ${nameOfForm(io)} in '${slot}' has no leaf — pass a Standard ` +
        `Schema or a primitive ('binary' | 'text').`,
    );
  }

  if (slot === 'output' && form.kind === 'multipart') {
    throw new TypeError(
      `${where}: form 'multipart' is input-only and cannot be declared in ` +
        `'output'.`,
    );
  }

  if (slot === 'output' && form.chain) {
    const step = typeChangingStep(form.chain);
    if (step) {
      throw new TypeError(
        `${where}: '.${step.op}()' changes the item type and is not allowed ` +
          `in 'output' — both ends of an output stream are fixed by its ` +
          `schema.`,
      );
    }
  }
}

/**
 * Проверяет формы обоих слотов декларации.
 *
 * Вызывается из `makeEndpoint`, поэтому действует для `httpEndpoint`,
 * `cliEndpoint` и прямого вызова `makeEndpoint`.
 */
export function assertFormSlots(
  pattern: string,
  input?: unknown,
  output?: unknown,
): void {
  assertSlot(pattern, 'input', input, describeForm(input));
  assertSlot(pattern, 'output', output, describeForm(output));
}
