/**
 * Переменная `Span`: участок трассы текущего запроса.
 *
 * Участок кладёт в контекст слой сателлита, а читает его прикладной код
 * через `Ctx(Span)`. Поверхность значения — два метода: сервис дописывает
 * атрибут или событие, не зная про OpenTelemetry SDK.
 *
 * Закрывает участок слой. Метода закрытия у значения нет: второй
 * закрыватель дал бы два участка с одним идентификатором.
 */

import type { ContextVar } from '@nestlingjs/app';
import { contextVar } from '@nestlingjs/app';
import type { Attributes, AttributeValue } from '@opentelemetry/api';

/**
 * Участок трассы глазами приложения: атрибут и событие.
 *
 * @example
 * ```typescript
 * @Component([Ctx(Span)])
 * export class UsersService {
 *   constructor(private readonly span: CtxReader<OtelSpan>) {}
 *
 *   find(id: string) {
 *     this.span.peek()?.setAttribute('user.id', id);
 *   }
 * }
 * ```
 */
export interface OtelSpan {
  /**
   * Ставит атрибут на участке.
   *
   * @param key - Имя атрибута
   * @param value - Значение атрибута
   */
  setAttribute(key: string, value: AttributeValue): void;

  /**
   * Добавляет событие на участок с отметкой времени вызова.
   *
   * @param name - Имя события
   * @param attributes - Атрибуты события
   */
  addEvent(name: string, attributes?: Attributes): void;
}

/**
 * Участок трассы текущего запроса — переменная слоя `otel(…).spans`.
 *
 * Экспортируется значением, потому что политика адресует **это** значение:
 * `everyEndpoint(…).hasVar(Span)` отклоняет сборку, если endpoint слой не
 * содержит.
 */
export const Span: ContextVar<OtelSpan, 'span'> =
  contextVar<OtelSpan>()('span');
