import type { IncomingMessage } from 'node:http';

import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  HandlerFn,
} from '@nestling/pipeline';
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
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P>): void {
    const store = {
      handler: definition.handle,
      definition: definition,
    };

    const [method, path] = definition.pattern.split(' ');

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
    handler: HandlerFn<any, any, any>;
    definition: EndpointDefinition<any, any, any>;
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
      handler: HandlerFn<any, any, any>;
      definition: EndpointDefinition<any, any, any>;
    };

    const params = result.params as Record<string, string>;

    return {
      handler: store.handler,
      definition: store.definition,
      params,
    };
  }
}
