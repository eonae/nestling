/**
 * Проверка форм io и объявленных исходов при создании декларации.
 *
 * Проверяется то, что известно без сборки приложения и без списка ключей
 * схемы: слот, вид формы, шаги цепочки, меняющие тип, и объявление
 * успешных исходов. Совпадение имени файлового поля с полем `fields`
 * проверяют типы (`NoFieldConflict`).
 *
 * Соответствие форм возможностям транспорта проверяется при сборке
 * приложения (`assertFormsSupported`).
 */

import { assertSuccessStatus } from '../status.js';

import type { ChainStep, FormDescriptor } from './forms.js';
import {
  describeForm,
  isForm,
  isNone,
  isOutcomes,
  isStreamKind,
  isUploadSpec,
} from './forms.js';

/** Слот декларации, в котором объявлена форма */
export type FormSlot = 'input' | 'output';

/** Человекочитаемое имя формы для текста ошибки */
export function nameOfForm(io: unknown): string {
  if (isUploadSpec(io)) {
    return 'upload()';
  }
  if (isOutcomes(io)) {
    return 'outputs({ … })';
  }
  if (isNone(io)) {
    return 'none()';
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
  where: string,
  slot: FormSlot,
  io: unknown,
  form: FormDescriptor,
): void {
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
 * Проверяет развилку исходов: два исхода и больше, статусы из словаря
 * ядра, форма каждой ветки — значение, примитив или `none()`.
 */
function assertOutcomes(where: string, output: unknown): void {
  const branches = Object.entries(
    (output as { outcomes: Record<string, unknown> }).outcomes,
  );

  if (branches.length === 0) {
    throw new Error(
      `${where}: 'output' declares outputs({ }) without a single outcome. ` +
        `Declare the outcomes, or drop 'output' — a declaration without it ` +
        `answers 'no_content'.`,
    );
  }

  if (branches.length === 1) {
    const [status] = branches[0];

    throw new Error(
      `${where}: 'output' declares outputs({ ${status}: … }) with a single ` +
        `outcome. One outcome is a form with the field ` +
        `'status: '${status}'' next to it; outputs({ … }) declares two and ` +
        `more.`,
    );
  }

  for (const [status, form] of branches) {
    assertSuccessStatus(status, where, `the key '${status}' of outputs({ … })`);

    if (isNone(form)) {
      continue;
    }

    if (isOutcomes(form)) {
      throw new TypeError(
        `${where}: outcome '${status}' is another outputs({ … }). A branch ` +
          `is a single form: a schema value, a primitive or none().`,
      );
    }

    if (isUploadSpec(form)) {
      throw new TypeError(
        `${where}: outcome '${status}' is an upload() specification, which ` +
          `is only valid inside multipart({ files: … }).`,
      );
    }

    if (!isForm(form)) {
      continue;
    }

    if (isStreamKind(form.kind)) {
      throw new Error(
        `${where}: outcome '${status}' is ${nameOfForm(form)}, and a ` +
          `streaming form is declared as the only outcome. Reconnect of SSE, ` +
          `the 'sse' section and the output item chain are read from the ` +
          `form of the declaration — before the handler runs, when the ` +
          `outcome is not known yet.`,
      );
    }

    throw new TypeError(
      `${where}: outcome '${status}' is ${nameOfForm(form)}, which is not a ` +
        `body of a response. A branch is a schema value, a primitive or ` +
        `none().`,
    );
  }
}

/**
 * Проверяет объявление успешного исхода: поле `status` и развилку.
 *
 * Развилка объявляет статусы ключами, поэтому поле `status` рядом с ней
 * не объявляется. Одиночная форма `output` статуса не называет — его даёт
 * поле или умолчание.
 */
function assertSuccessDeclaration(
  where: string,
  output: unknown,
  status: unknown,
): void {
  if (isOutcomes(output)) {
    assertOutcomes(where, output);

    if (status !== undefined) {
      throw new Error(
        `${where}: 'status' is declared next to outputs({ … }), which ` +
          `already names the statuses with its keys. Two declarations of the ` +
          `same thing come apart on the first edit: drop 'status', or ` +
          `declare a single form in 'output'.`,
      );
    }

    return;
  }

  if (isNone(output)) {
    throw new TypeError(
      `${where}: 'none()' in 'output' declares an outcome without a body ` +
        `and is only valid inside outputs({ … }). A declaration that ` +
        `answers without a body is written without 'output'.`,
    );
  }

  if (status === undefined) {
    return;
  }

  assertSuccessStatus(status, where);

  if (status === 'no_content' && output !== undefined) {
    throw new Error(
      `${where}: 'status: 'no_content'' is declared next to 'output', which ` +
        `promises a body by a schema. A response with that status carries ` +
        `no body: drop 'output', or name the status of the body ` +
        `('ok', 'created', 'accepted').`,
    );
  }
}

/**
 * Проверяет формы обоих слотов декларации и объявление её исходов.
 *
 * Вызывается из `makeEndpoint` и из конструкторов операции, поэтому
 * действует для `httpEndpoint`, `cliEndpoint`, прямого вызова
 * `makeEndpoint` и `makeRequest`.
 *
 * @param where - Владелец в тексте ошибки: `Endpoint 'GET /users'` или
 * `Operation 'users.create'`
 */
export function assertIoDeclaration(
  where: string,
  input?: unknown,
  output?: unknown,
  status?: unknown,
): void {
  assertSlot(where, 'input', input, describeForm(input));
  assertSuccessDeclaration(where, output, status);

  if (!isOutcomes(output) && !isNone(output)) {
    assertSlot(where, 'output', output, describeForm(output));
  }
}
