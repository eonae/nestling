import { assertEndpointsDeclared, discoverEndpoints } from './discovery';
import type { AppModule } from './module';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeModule } from '@nestling/container';
import type { IEndpoint } from '@nestling/pipeline';
import { Endpoint, Ok } from '@nestling/pipeline';

const endpointClass = (
  transport: string,
  pattern: string,
  name = 'TestEndpoint',
) => {
  @Injectable([])
  @Endpoint({ transport, pattern })
  class TestEndpoint implements IEndpoint {
    async handle() {
      return new Ok({});
    }
  }

  // Имя класса участвует в текстах ошибок — задаём его явно
  Object.defineProperty(TestEndpoint, 'name', { value: name });

  return TestEndpoint;
};

describe('discoverEndpoints', () => {
  it('несёт атрибуцию к модулю-объявителю', () => {
    const GetUser = endpointClass('http', 'GET /users/:id');

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
    expect(endpoints[0].metadata).toMatchObject({
      transport: 'http',
      pattern: 'GET /users/:id',
    });
  });

  it('обнаруживает эндпоинты на модуле, собранном makeModule вручную', () => {
    const Handmade = endpointClass('http', 'GET /handmade');

    const HandmadeModule = {
      ...makeModule({ name: 'module:handmade', providers: [Handmade] }),
      endpoints: [Handmade],
    };

    const { endpoints } = discoverEndpoints([HandmadeModule]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].moduleName).toBe('module:handmade');
  });

  it('цикл в imports не зацикливает обход', () => {
    const FromA = endpointClass('http', 'GET /a');
    const FromB = endpointClass('http', 'GET /b');

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
    const SharedEndpoint = endpointClass('http', 'GET /shared');

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
    const First = endpointClass('http', 'GET /first');
    const Second = endpointClass('http', 'GET /second');

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
    const Imported = endpointClass('http', 'GET /imported');
    const Own = endpointClass('http', 'GET /own');
    const Other = endpointClass('http', 'GET /other');

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

  it('повтор класса внутри endpoints: одного модуля даёт одну запись', () => {
    const Duplicated = endpointClass('http', 'GET /dup');

    const DupModule = makeAppModule({
      name: 'module:dup',
      endpoints: [Duplicated, Duplicated],
    });

    const { endpoints } = discoverEndpoints([DupModule]);

    expect(endpoints).toHaveLength(1);
  });

  it('группирует ручки по требуемому транспорту', () => {
    const HttpOne = endpointClass('http', 'GET /one');
    const HttpTwo = endpointClass('http', 'GET /two');
    const CliOne = endpointClass('cli', 'do-something');

    const MixedModule = makeAppModule({
      name: 'module:mixed',
      endpoints: [HttpOne, HttpTwo, CliOne],
    });

    const { transports } = discoverEndpoints([MixedModule]);

    expect([...transports.keys()].sort()).toEqual(['cli', 'http']);
    expect(transports.get('http')).toHaveLength(2);
    expect(transports.get('cli')).toHaveLength(1);
  });

  it('класс в endpoints: без метаданных — ошибка с именем класса и модуля', () => {
    @Injectable([])
    class NotAnEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    const BrokenModule = makeAppModule({
      name: 'module:broken',
      endpoints: [NotAnEndpoint],
    });

    expect(() => discoverEndpoints([BrokenModule])).toThrow(
      /NotAnEndpoint.*module:broken.*no endpoint metadata/s,
    );
  });

  it('не требует контейнера и транспортов', () => {
    const Standalone = endpointClass('http', 'GET /standalone');

    const StandaloneModule = makeAppModule({
      name: 'module:standalone',
      endpoints: [Standalone],
    });

    // Ни build(), ни транспортов — только значение-модуль
    expect(discoverEndpoints([StandaloneModule]).endpoints).toHaveLength(1);
  });
});

describe('assertEndpointsDeclared', () => {
  it('класс с метаданными в providers мимо endpoints: — ошибка', () => {
    const Smuggled = endpointClass('http', 'GET /smuggled', 'Smuggled');

    const SmugglingModule = makeModule({
      name: 'module:smuggling',
      providers: [Smuggled],
    });

    expect(() => assertEndpointsDeclared([SmugglingModule])).toThrow(
      /Smuggled.*module:smuggling.*'endpoints:'/s,
    );
  });

  it('та же конфигурация через ProvidersFactory не линтуется', () => {
    const Smuggled = endpointClass('http', 'GET /smuggled-lazy');

    const LazyModule = makeModule({
      name: 'module:lazy',
      providers: () => [Smuggled],
    });

    expect(() => assertEndpointsDeclared([LazyModule])).not.toThrow();
  });

  it('эндпоинт, объявленный в endpoints:, провайдером быть может', () => {
    const Declared = endpointClass('http', 'GET /declared');

    const DeclaredModule = makeAppModule({
      name: 'module:declared',
      endpoints: [Declared],
    });

    expect(() => assertEndpointsDeclared([DeclaredModule])).not.toThrow();
  });

  it('корневые providers приложения линтуются наравне с модулями', () => {
    const RootSmuggled = endpointClass('http', 'GET /root', 'RootSmuggled');

    expect(() => assertEndpointsDeclared([], [RootSmuggled])).toThrow(
      /RootSmuggled.*'endpoints:'/s,
    );
  });
});
