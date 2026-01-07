import type { IncomingMessage } from 'node:http';

import type { MaybeSchema } from '@common/misc';
import type { HandlerFn } from '@nestling/pipeline';
import type { RouteConfig } from '@nestling/transport';
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
  route<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(config: RouteConfig<P, M, R>): void {
    // Создаем store с handler и config
    const store = {
      handler: config.handle,
      config,
    };

    const [method, path] = config.pattern.split(' ');

    this.router.on(
      method.toUpperCase() as Router.HTTPMethod,
      path,
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
    handler: HandlerFn;
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

    const store = result.store as {
      handler: HandlerFn;
      config: RouteConfig;
    };

    const params = result.params as Record<string, string>;

    return {
      handler: store.handler,
      config: store.config,
      params,
    };
  }
}
