import type { IncomingMessage } from 'node:http';

import type { RouteDeclaration } from '@nestling/transport';
import Router from 'find-my-way';

/**
 * Обёртка над find-my-way для маршрутизации HTTP-запросов.
 *
 * Хранит проекции деклараций без `handle` и `pipeline`; endpoint исполняет
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

    this.router.on(
      method.toUpperCase() as Router.HTTPMethod,
      path,
      () => {
        // Обработчик find-my-way не нужен: декларация лежит в store
      },
      { declaration },
    );
  }

  /** Находит маршрут и path-параметры запроса; `null`, если маршрута нет */
  find(req: IncomingMessage): {
    declaration: RouteDeclaration;
    params: Record<string, string>;
  } | null {
    const result = this.router.find(
      req.method as Router.HTTPMethod,
      req.url || '/',
    );

    if (!result) {
      return null;
    }

    const { declaration } = result.store as { declaration: RouteDeclaration };

    return {
      declaration,
      params: result.params as Record<string, string>,
    };
  }
}
