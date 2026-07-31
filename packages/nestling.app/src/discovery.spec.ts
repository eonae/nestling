import { discoverEndpoints } from './discovery';
import type { AppModule } from './module';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeModule, makeToken } from '@nestling/container';
import type { TransportRef } from '@nestling/pipeline';
import { makeEndpoint, Ok, transportNameOf } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/** Токены транспортов фикстур: ссылка декларации — значение, а не строка */
const Http$ = makeToken('transport:http') as TransportRef;
const Cli$ = makeToken('transport:cli') as TransportRef;

/** Декларация-значение: единица дискавери */
const endpoint = (transport: TransportRef, pattern: string) =>
  makeEndpoint({
    transport,
    pattern,
    handle: async () => new Ok({}),
  });

describe('discoverEndpoints', () => {
  it('несёт атрибуцию к модулю-объявителю', () => {
    const GetUser = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      handle: async () => new Ok({}),
    });

    const UsersModule = makeAppModule({
      name: 'module:users',
      endpoints: [GetUser],
    });

    const { endpoints } = discoverEndpoints([UsersModule]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      endpoint: GetUser,
      moduleName: 'module:users',
    });

    // Транспорт и паттерн читаются с самой декларации; транспорт — токен
    expect(transportNameOf(endpoints[0].endpoint.transport)).toBe('http');
    expect(endpoints[0].endpoint.pattern).toBe('GET /users/:id');
  });

  it('обнаруживает эндпоинты на модуле, собранном makeModule вручную', () => {
    const Handmade = endpoint(Http$, 'GET /handmade');

    const HandmadeModule = {
      ...makeModule({ name: 'module:handmade' }),
      endpoints: [Handmade],
    };

    const { endpoints } = discoverEndpoints([HandmadeModule]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].moduleName).toBe('module:handmade');
  });

  it('цикл в imports не зацикливает обход', () => {
    const FromA = endpoint(Http$, 'GET /a');
    const FromB = endpoint(Http$, 'GET /b');

    const ModuleA: AppModule = makeAppModule({
      name: 'module:a',
      endpoints: [FromA],
    });
    const ModuleB: AppModule = makeAppModule({
      name: 'module:b',
      imports: [ModuleA],
      endpoints: [FromB],
    });
    ModuleA.imports = [ModuleB];

    const { endpoints } = discoverEndpoints([ModuleA]);

    expect(endpoints.map((found) => found.endpoint)).toEqual([FromB, FromA]);
  });

  it('общий модуль, импортированный в двух ветках, обходится один раз', () => {
    const SharedEndpoint = endpoint(Http$, 'GET /shared');

    const SharedModule = makeAppModule({
      name: 'module:shared',
      endpoints: [SharedEndpoint],
    });
    const ModuleA = makeAppModule({
      name: 'module:a',
      imports: [SharedModule],
    });
    const ModuleB = makeAppModule({
      name: 'module:b',
      imports: [SharedModule],
    });

    const { endpoints } = discoverEndpoints([ModuleA, ModuleB]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].endpoint).toBe(SharedEndpoint);
  });

  it('два разных модуля с одним name — ошибка обхода', () => {
    const First = endpoint(Http$, 'GET /first');
    const Second = endpoint(Http$, 'GET /second');

    const ModuleFirst = makeAppModule({
      name: 'module:same-name',
      endpoints: [First],
    });
    const ModuleSecond = makeAppModule({
      name: 'module:same-name',
      endpoints: [Second],
    });

    // Пропустить второе значение значило бы потерять `GET /second` молча —
    // контейнер на этом падает, дискавери зеркалит правило
    expect(() => discoverEndpoints([ModuleFirst, ModuleSecond])).toThrow(
      /Two different modules are named 'module:same-name'/,
    );
  });

  it('то же значение модуля, переданное дважды, обходится один раз', () => {
    const Only = endpoint(Http$, 'GET /only');

    const Shared = makeAppModule({
      name: 'module:shared-value',
      endpoints: [Only],
    });

    const { endpoints } = discoverEndpoints([Shared, Shared]);

    expect(endpoints.map((found) => found.endpoint)).toEqual([Only]);
  });

  it('порядок воспроизводим: imports раньше собственных эндпоинтов', () => {
    const Imported = endpoint(Http$, 'GET /imported');
    const Own = endpoint(Http$, 'GET /own');
    const Other = endpoint(Http$, 'GET /other');

    const ImportedModule = makeAppModule({
      name: 'module:imported',
      endpoints: [Imported],
    });
    const OwnModule = makeAppModule({
      name: 'module:own',
      imports: [ImportedModule],
      endpoints: [Own, Other],
    });

    const first = discoverEndpoints([OwnModule]);
    const second = discoverEndpoints([OwnModule]);

    expect(first.endpoints.map((found) => found.endpoint)).toEqual([
      Imported,
      Own,
      Other,
    ]);
    expect(second.endpoints.map((found) => found.endpoint)).toEqual(
      first.endpoints.map((found) => found.endpoint),
    );
  });

  it('повтор одной декларации внутри endpoints: даёт одну запись', () => {
    const Duplicated = endpoint(Http$, 'GET /dup');

    const DupModule = makeAppModule({
      name: 'module:dup',
      endpoints: [Duplicated, Duplicated],
    });

    const { endpoints } = discoverEndpoints([DupModule]);

    expect(endpoints).toHaveLength(1);
  });

  it('группирует ручки по требуемому транспорту', () => {
    const MixedModule = makeAppModule({
      name: 'module:mixed',
      endpoints: [
        endpoint(Http$, 'GET /one'),
        endpoint(Http$, 'GET /two'),
        endpoint(Cli$, 'do-something'),
      ],
    });

    const { transports } = discoverEndpoints([MixedModule]);

    // Ключ карты — токен транспорта, а не его строковое имя
    expect([...transports.keys()].sort()).toEqual([Cli$, Http$].sort());
    expect(transports.get(Http$)).toHaveLength(2);
    expect(transports.get(Cli$)).toHaveLength(1);
  });

  it('элемент endpoints: без бренда — ошибка с модулем и индексом', () => {
    @Injectable([])
    class NotAnEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    const BrokenModule = makeAppModule({
      name: 'module:broken',
      // Опечатка автора: в endpoints: попал сервис вместо декларации
      endpoints: [endpoint(Http$, 'GET /ok'), NotAnEndpoint as never],
    });

    expect(() => discoverEndpoints([BrokenModule])).toThrow(
      /module:broken.*NotAnEndpoint.*index 1.*not an endpoint declaration/s,
    );
  });

  it('undefined в endpoints: тоже ошибка, а не молчаливый пропуск', () => {
    const BrokenModule = makeAppModule({
      name: 'module:undefined',
      endpoints: [undefined as never],
    });

    expect(() => discoverEndpoints([BrokenModule])).toThrow(
      /module:undefined.*index 0/s,
    );
  });

  it('не требует контейнера и транспортов', () => {
    const StandaloneModule = makeAppModule({
      name: 'module:standalone',
      endpoints: [endpoint(Http$, 'GET /standalone')],
    });

    // Ни build(), ни транспортов — только значение-модуль
    expect(discoverEndpoints([StandaloneModule]).endpoints).toHaveLength(1);
  });
});
