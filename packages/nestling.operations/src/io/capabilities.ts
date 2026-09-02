/**
 * Возможности транспорта по формам io и их проверка при сборке.
 *
 * Соответствие формы декларации и транспорта проверяется на собранном
 * графе, а не типами: типовая проверка потребовала бы указать транспорт в
 * декларации, а декларация от транспорта не зависит
 * (`docs/design/transports.md`).
 */

import type { FormKind } from './forms.js';
import { describeForm } from './forms.js';

import type { Token } from '@nestling/container/tokens';
import { tokenId } from '@nestling/container/tokens';

/**
 * Формы io, которые транспорт умеет принимать и отдавать.
 *
 * Их читает `assertFormsSupported` до приёма первого запроса.
 */
export interface TransportCapabilities {
  readonly input: ReadonlySet<FormKind>;
  readonly output: ReadonlySet<FormKind>;
}

/**
 * Декларация в объёме, нужном для проверки возможностей.
 *
 * `transport` — токен транспорта; в текст ошибки попадает его короткое
 * имя.
 */
export interface FormBearingDefinition {
  readonly transport: Token<any>;
  readonly pattern: string;
  readonly input?: unknown;
  readonly output?: unknown;
}

/**
 * Короткое имя транспорта из id токена (`transport:http:default` →
 * `'http'`, `transport:http:admin` → `'http:admin'`).
 *
 * Повторяет `transportNameOf` из `@nestling/pipeline`: импортировать его
 * сюда нельзя, а правило умещается в несколько строк.
 */
const shortTransportName = (token: Token<any>): string => {
  const id = tokenId(token);
  const named = id.startsWith('transport:')
    ? id.slice('transport:'.length)
    : id;

  return named.endsWith(':default')
    ? named.slice(0, -':default'.length)
    : named;
};

function listForms(kinds: ReadonlySet<FormKind>): string {
  return [...kinds].join(', ');
}

/**
 * Бросает ошибку, если форма декларации не входит в возможности
 * транспорта.
 *
 * Одна реализация для обоих путей регистрации: через `App` (декларации из
 * дерева модулей) и через `transport.endpoint(...)` напрямую. В обоих
 * случаях проверка идёт до приёма запросов.
 *
 * @param where - Уточнение для текста ошибки, например имя модуля
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
