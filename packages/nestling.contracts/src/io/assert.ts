/**
 * Fail-fast форм io **в момент создания декларации**.
 *
 * Проверяется ровно то, что решаемо без сборки приложения и без перечня
 * ключей схемы: слот, вид формы и тип-меняющие шаги цепочки. Проверка
 * «имя файлового поля совпало с полем `fields`» живёт в типах
 * (`multipart` принимает `NoFieldConflict`) — Standard Schema перечня
 * ключей не отдаёт, то же ограничение уже зафиксировано для
 * path-параметров.
 *
 * Соответствие форм способностям транспорта сюда не входит: транспорт
 * выбирается на сборке (`assertFormsSupported`).
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
 * Шаги, заведомо меняющие тип элемента.
 *
 * `through` сюда не входит: сохраняет ли он тип, знают только типы —
 * рантайм этого не видит, и запрещать его целиком значило бы отобрать
 * легальный `T → T`-вариант.
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
 * Зовётся kernel-примитивом `makeEndpoint`, поэтому одинаково работает
 * для `httpEndpoint`, `cliEndpoint` и прямого использования примитива.
 */
export function assertFormSlots(
  pattern: string,
  input?: unknown,
  output?: unknown,
): void {
  assertSlot(pattern, 'input', input, describeForm(input));
  assertSlot(pattern, 'output', output, describeForm(output));
}
