import { discoverEndpoints } from './discovery';
import type { AppModule } from './module';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeModule } from '@nestling/container';
import { makeEndpoint, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/** Декларация-значение: единица дискавери */
const endpoint = (transport: string, pattern: string) =>
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

    // Транспорт и паттерн читаются с самой декларации
    expect(endpoints[0].endpoint.transport).toBe('http');
    expect(endpoints[0].endpoint.pattern).toBe('GET /users/:id');
  });

  it('обнаруживает эндпоинты на модуле, собранном makeModule вручную', () => {
    const Handmade = endpoint('http', 'GET /handmade');

    const HandmadeModule = {
      ...makeModule({ name: 'module:handmade' }),
      endpoints: [Handmade],
    };

    const { endpoints } = discoverEndpoints([HandmadeModule]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].moduleName).toBe('module:handmade');
  });

  it('цикл в imports не зацикливает обход', () => {
    const FromA = endpoint('http', 'GET /a');
    const FromB = endpoint('http', 'GET /b');

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
    const SharedEndpoint = endpoint('http', 'GET /shared');

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

  it('два разных объекта модуля с одним name считаются одним модулем', () => {
    const First = endpoint('http', 'GET /first');
    const Second = endpoint('http', 'GET /second');

    const ModuleFirst = makeAppModule({
      name: 'module:same-name',
      endpoints: [First],
    });
    const ModuleSecond = makeAppModule({
      name: 'module:same-name',
      endpoints: [Second],
    });

    const { endpoints } = discoverEndpoints([ModuleFirst, ModuleSecond]);

    // Контейнер молча игнорирует второй одноимённый модуль — дискавери тоже
    expect(endpoints.map((found) => found.endpoint)).toEqual([First]);
  });

  it('порядок воспроизводим: imports раньше собственных эндпоинтов', () => {
    const Imported = endpoint('http', 'GET /imported');
    const Own = endpoint('http', 'GET /own');
    const Other = endpoint('http', 'GET /other');

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
    const Duplicated = endpoint('http', 'GET /dup');

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
        endpoint('http', 'GET /one'),
        endpoint('http', 'GET /two'),
        endpoint('cli', 'do-something'),
      ],
    });

    const { transports } = discoverEndpoints([MixedModule]);

    expect([...transports.keys()].sort()).toEqual(['cli', 'http']);
    expect(transports.get('http')).toHaveLength(2);
    expect(transports.get('cli')).toHaveLength(1);
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
      endpoints: [endpoint('http', 'GET /ok'), NotAnEndpoint as never],
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
      endpoints: [endpoint('http', 'GET /standalone')],
    });

    // Ни build(), ни транспортов — только значение-модуль
    expect(discoverEndpoints([StandaloneModule]).endpoints).toHaveLength(1);
  });
});
