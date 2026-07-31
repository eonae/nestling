/**
 * Способности транспорта по формам io и проверка биндинга на сборке.
 *
 * Богатство объявляется в контракте, а согласуется **проверкой биндинга**:
 * связать декларацию и транспорт типами можно было бы только протащив тип
 * транспорта в декларацию, а это прямо противоречит «pipeline и handler
 * транспорт-слепые». Ровно тот случай, где журнал предписывает проверку на
 * графе, а не церемонию в типах.
 */

import type { FormKind } from './forms.js';
import { describeForm } from './forms.js';

/**
 * Формы io, которые транспорт умеет принимать и отдавать.
 *
 * Данные транспорта, а не конвенция: их читает `assertFormsSupported` до
 * приёма первого запроса.
 */
export interface TransportCapabilities {
  readonly input: ReadonlySet<FormKind>;
  readonly output: ReadonlySet<FormKind>;
}

/**
 * Декларация с точки зрения проверки способностей.
 *
 * `transport` — токен (у проекции маршрута он тот же, что у декларации);
 * в текст ошибки уходит короткое имя, выведенное из его id.
 */
export interface FormBearingDefinition {
  readonly transport: string;
  readonly pattern: string;
  readonly input?: unknown;
  readonly output?: unknown;
}

/**
 * Короткое имя транспорта из id токена (`transport:http` → `'http'`).
 *
 * Дублирует `transportNameOf` из `../../metadata`: импорт оттуда завёл бы
 * цикл модулей (`metadata` строится над `core`), а правило — одна строчка.
 */
const shortTransportName = (id: string): string => {
  const separator = id.lastIndexOf(':');

  return separator === -1 ? id : id.slice(separator + 1);
};

function listForms(kinds: ReadonlySet<FormKind>): string {
  return [...kinds].join(', ');
}

/**
 * Отвергает декларацию, чья форма не входит в способности транспорта.
 *
 * Одна реализация с одним текстом для обоих путей регистрации:
 * `App` (декларации из дерева модулей) и `transport.endpoint(...)`
 * напрямую (standalone). Обе точки — до приёма запросов, что и есть
 * fail-fast на сборке.
 *
 * @param where - уточнение контекста для текста ошибки (например, имя
 * модуля-объявителя)
 */
export function assertFormsSupported(
  definition: FormBearingDefinition,
  capabilities: TransportCapabilities,
  where?: string,
): void {
  const slots = [
    {
      slot: 'input' as const,
      io: definition.input,
      allowed: capabilities.input,
    },
    {
      slot: 'output' as const,
      io: definition.output,
      allowed: capabilities.output,
    },
  ];

  for (const { slot, io, allowed } of slots) {
    const { kind } = describeForm(io);
    if (allowed.has(kind)) {
      continue;
    }

    throw new Error(
      `Endpoint '${definition.pattern}'${where ? ` ${where}` : ''}: ` +
        `transport '${shortTransportName(definition.transport)}' ` +
        `does not support form ` +
        `'${kind}' in '${slot}' (supported: ${listForms(allowed)}).`,
    );
  }
}
