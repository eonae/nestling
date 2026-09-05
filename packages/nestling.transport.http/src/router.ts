import type { IncomingMessage } from 'node:http';

import { bindingNeedsBody, httpBindingOf } from './binding.js';

import type { HttpBinding } from '@nestling/operations';
import type { FormDescriptor } from '@nestling/pipeline';
import { describeForm } from '@nestling/pipeline';
import type { RouteDeclaration } from '@nestling/transport';
import Router from 'find-my-way';

/**
 * Запись маршрута: проекция декларации и всё, что транспорт вычисляет по
 * ней один раз при регистрации, а не на каждый запрос.
 */
export interface RouteEntry {
  readonly declaration: RouteDeclaration;

  /** Bind-карта: откуда читать каждое поле входа */
  readonly binding: HttpBinding;

  readonly inputForm: FormDescriptor;

  readonly outputForm: FormDescriptor;

  /** Требует ли bind-карта чтения тела */
  readonly needsBody: boolean;

  /**
   * Читает ли bind-карта query-строку: источник «остальное» — query или
   * хотя бы одно поле помечено `query()`. Иначе query не разбирается.
   */
  readonly readsQuery: boolean;
}

/**
 * Обёртка над find-my-way для маршрутизации HTTP-запросов.
 *
 * Хранит записи маршрутов без `handle` и `pipeline`; endpoint исполняет
 * `dispatch.call` по паттерну найденного маршрута.
 */
export class HttpRouter {
  private readonly router: Router.Instance<Router.HTTPVersion.V1>;

  constructor() {
    this.router = Router({
      defaultRoute: () => {
        throw new Error('Route not found');
      },
    });
  }

  /** Регистрирует маршрут по проекции декларации */
  route(declaration: RouteDeclaration): void {
    const [method, path] = declaration.pattern.split(' ');
    const binding = httpBindingOf(declaration);

    const entry: RouteEntry = {
      declaration,
      binding,
      inputForm: describeForm(declaration.input),
      outputForm: describeForm(declaration.output),
      needsBody: bindingNeedsBody(binding),
      readsQuery:
        binding.rest === 'query' ||
        Object.values(binding.fields).some(
          (placement) => placement.in === 'query',
        ),
    };

    this.router.on(
      method.toUpperCase() as Router.HTTPMethod,
      path,
      () => {
        // Обработчик find-my-way не нужен: запись лежит в store
      },
      entry,
    );
  }

  /** Находит маршрут и path-параметры запроса; `null`, если маршрута нет */
  find(req: IncomingMessage): {
    route: RouteEntry;
    params: Record<string, string>;
  } | null {
    const result = this.router.find(
      req.method as Router.HTTPMethod,
      req.url || '/',
    );

    if (!result) {
      return null;
    }

    return {
      route: result.store as RouteEntry,
      params: result.params as Record<string, string>,
    };
  }
}
