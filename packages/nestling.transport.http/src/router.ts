import type { IncomingMessage } from 'node:http';

import type { RouteDeclaration } from '@nestling/transport';
import Router from 'find-my-way';

/**
 * Обертка над find-my-way для роутинга HTTP запросов.
 *
 * Хранит **проекции** деклараций: исполнимых полей у транспорта нет, ручку
 * исполняет `dispatch.call` по паттерну найденного маршрута.
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

  /**
   * Регистрирует маршрут по проекции декларации
   */
  route(declaration: RouteDeclaration): void {
    const [method, path] = declaration.pattern.split(' ');

    this.router.on(
      method.toUpperCase() as Router.HTTPMethod,
      path,
      () => {
        // Handler вызывается при совпадении, но нам не нужна логика здесь
        // Все данные уже в store
      },
      { declaration },
    );
  }

  /**
   * Находит маршрут для запроса
   */
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
