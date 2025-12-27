import type { IncomingMessage } from 'node:http';

import type { Handler, RouteConfig } from '../core/interfaces.js';

import Router from 'find-my-way';

/**
 * Обертка над find-my-way для роутинга HTTP запросов
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
   * Регистрирует маршрут
   */
  route(config: RouteConfig): void {
    // Создаем store с handler и config
    const store = {
      handler: config.handler,
      config,
    };

    this.router.on(
      config.method.toUpperCase() as Router.HTTPMethod,
      config.path,
      () => {
        // Handler вызывается при совпадении, но нам не нужна логика здесь
        // Все данные уже в store
      },
      store,
    );
  }

  /**
   * Находит маршрут для запроса
   */
  find(req: IncomingMessage): {
    handler: Handler;
    config: RouteConfig;
    params: Record<string, string>;
  } | null {
    const result = this.router.find(
      req.method as Router.HTTPMethod,
      req.url || '/',
    );

    if (!result) {
      return null;
    }

    const store = result.store as { handler: Handler; config: RouteConfig };
    const params = result.params as Record<string, string>;

    return {
      handler: store.handler,
      config: store.config,
      params,
    };
  }
}
