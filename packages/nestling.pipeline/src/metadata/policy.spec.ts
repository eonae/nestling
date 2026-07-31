/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты: предмет проверки — идентичность слоя, а не его эффект */
/**
 * Словарь политик: фильтры, `hasLayer` и исключение detached-ручек.
 *
 * Проверяется предикат в изоляции от приложения: субъекты собираются
 * руками, ровно в той форме, в какой их отдаёт дискавери.
 */

import { compose, contextVar, makePipeline, Ok } from '../core';

import { makeEndpoint } from './endpoint';
import type { PolicySubject } from './policy';
import { everyEndpoint } from './policy';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';

const HttpTransport$ = makeToken('transport:http');
const CliTransport$ = makeToken('transport:cli');

const base = makePipeline().pre(() => {});
const authedBase = makePipeline().pre(() => {});
const other = makePipeline().pre(() => {});

const handle = async () => new Ok({ ok: true });

function subject(options: {
  transport?: typeof HttpTransport$;
  pattern: string;
  pipeline?: unknown;
  detached?: string;
  moduleName?: string;
}): PolicySubject {
  const { transport = HttpTransport$, pattern, moduleName, ...rest } = options;

  return {
    endpoint: (makeEndpoint as (o: unknown) => never)({
      transport,
      pattern,
      handle,
      ...rest,
    }),
    moduleName: moduleName ?? 'module:test',
  };
}

describe('everyEndpoint — фильтры', () => {
  const policy = everyEndpoint({ transport: HttpTransport$ }).hasLayer(
    authedBase,
    'authedBase',
  );

  it('ручка чужого транспорта под политику не попадает', () => {
    const subjects = [
      subject({ pattern: 'GET /users', pipeline: authedBase }),
      subject({
        transport: CliTransport$,
        pattern: 'import-users',
        pipeline: other,
      }),
    ];

    expect(policy.check(subjects)).toEqual([]);
  });

  it('фильтр по паттерну сужает множество', () => {
    const byPattern = everyEndpoint({ pattern: /^\w+ \/admin\// }).hasLayer(
      authedBase,
    );

    const violations = byPattern.check([
      subject({ pattern: 'GET /health', pipeline: other }),
      subject({ pattern: 'GET /admin/users', pipeline: other }),
    ]);

    expect(violations.map((v) => v.pattern)).toEqual(['GET /admin/users']);
  });

  it('фильтры конъюнктивны', () => {
    const both = everyEndpoint({
      transport: HttpTransport$,
      pattern: /^GET /,
    }).hasLayer(authedBase);

    const violations = both.check([
      subject({ pattern: 'POST /users', pipeline: other }),
      subject({
        transport: CliTransport$,
        pattern: 'GET whatever',
        pipeline: other,
      }),
      subject({ pattern: 'GET /users', pipeline: other }),
    ]);

    expect(violations.map((v) => v.pattern)).toEqual(['GET /users']);
  });

  it('пустой фильтр берёт все ручки любого транспорта', () => {
    const all = everyEndpoint().hasLayer(authedBase);

    const violations = all.check([
      subject({ pattern: 'GET /users', pipeline: other }),
      subject({
        transport: CliTransport$,
        pattern: 'import-users',
        pipeline: other,
      }),
    ]);

    expect(violations).toHaveLength(2);
  });

  it('строка вместо RegExp отвергается в точке объявления', () => {
    expect(() =>
      everyEndpoint({ pattern: '^/admin' as unknown as RegExp }),
    ).toThrow(TypeError);
  });

  it('приложение без ручек проходит любую политику', () => {
    expect(policy.check([])).toEqual([]);
    expect(everyEndpoint().hasLayer(authedBase).check([])).toEqual([]);
  });
});

describe('hasLayer — идентичность слоя по ссылке', () => {
  const policy = everyEndpoint().hasLayer(authedBase, 'authedBase');

  it('композированный слой удовлетворяет политике', () => {
    const subjects = [
      subject({ pattern: 'GET /users', pipeline: compose(base, authedBase) }),
      subject({ pattern: 'GET /me', pipeline: authedBase }),
      subject({
        pattern: 'GET /orders',
        pipeline: compose(
          base,
          authedBase.pre(() => {}),
        ),
      }),
    ];

    expect(policy.check(subjects)).toEqual([]);
  });

  it('чужой слой нарушает, и нарушение называет ручку, транспорт и модуль', () => {
    const violations = policy.check([
      subject({
        pattern: 'GET /users',
        pipeline: compose(base, other),
        moduleName: 'module:users',
      }),
    ]);

    expect(violations).toEqual([
      {
        pattern: 'GET /users',
        transport: 'http',
        moduleName: 'module:users',
        detail: "its pipeline is not composed from layer 'authedBase'",
      },
    ]);
  });

  it('ручка без пайплайна нарушает', () => {
    const [violation] = policy.check([subject({ pattern: 'GET /health' })]);

    expect(violation.detail).toContain('declares no pipeline');
  });

  it('без метки диагностика говорит про требуемый слой', () => {
    const unlabeled = everyEndpoint().hasLayer(authedBase);

    expect(unlabeled.describe()).toBe('every endpoint has the required layer');
    expect(
      unlabeled.check([subject({ pattern: 'GET /users', pipeline: other })])[0]
        .detail,
    ).toBe('its pipeline is not composed from the required layer');
  });

  it('описание политики называет фильтр и метку слоя', () => {
    expect(
      everyEndpoint({ transport: HttpTransport$, pattern: /^GET/ })
        .hasLayer(authedBase, 'authedBase')
        .describe(),
    ).toBe(
      "every endpoint (transport 'http', pattern /^GET/) has layer 'authedBase'",
    );
  });
});

describe('hasVar — присутствие ambient-переменной', () => {
  const RequestId = contextVar<string>()('requestId');
  const observability = makePipeline().pre(RequestId.provide(() => 'req-1'));
  const policy = everyEndpoint({ transport: HttpTransport$ }).hasVar(
    RequestId,
    'requestId',
  );

  it('ручка, композированная от слоя-писателя, инвариант соблюдает', () => {
    const subjects = [
      subject({
        pattern: 'GET /users',
        pipeline: compose(base, observability),
      }),
      subject({ pattern: 'GET /me', pipeline: observability }),
      subject({
        pattern: 'GET /orders',
        pipeline: observability.pre(() => {}),
      }),
    ];

    expect(policy.check(subjects)).toEqual([]);
  });

  it('ручка без писателя перечислена с координатами и починкой', () => {
    const violations = policy.check([
      subject({
        pattern: 'GET /users',
        pipeline: compose(base, other),
        moduleName: 'module:users',
      }),
    ]);

    expect(violations).toEqual([
      {
        pattern: 'GET /users',
        transport: 'http',
        moduleName: 'module:users',
        detail:
          "its pipeline does not declare context variable 'requestId' — " +
          "compose a layer with <Var>.provide(…) into its 'pipeline:', or " +
          "opt out with detached: '<reason>'",
      },
    ]);
  });

  it('ручка без пайплайна нарушает', () => {
    const [violation] = policy.check([subject({ pattern: 'GET /health' })]);

    expect(violation.detail).toContain('declares no pipeline');
    expect(violation.detail).toContain("context variable 'requestId'");
  });

  it('detached исключается', () => {
    expect(
      policy.check([
        subject({
          pattern: 'GET /health',
          detached: 'liveness-проба: до слоя наблюдаемости не доходит',
        }),
      ]),
    ).toEqual([]);
  });

  it('юнит, кладущий поле вручную, политику не удовлетворяет', () => {
    const manual = makePipeline().pre(async () => ({ requestId: 'req-1' }));

    const [violation] = policy.check([
      subject({ pattern: 'GET /users', pipeline: manual }),
    ]);

    expect(violation.detail).toContain('<Var>.provide');
  });

  it('переменная-омоним политику не удовлетворяет', () => {
    const twin = contextVar<string>()('requestId');
    const twinPolicy = everyEndpoint().hasVar(twin);

    expect(
      twinPolicy.check([
        subject({ pattern: 'GET /users', pipeline: observability }),
      ]),
    ).toHaveLength(1);
  });

  it('без метки диагностика называет ключ переменной', () => {
    const unlabeled = everyEndpoint({ transport: HttpTransport$ }).hasVar(
      RequestId,
    );

    expect(unlabeled.describe()).toBe(
      "every endpoint (transport 'http') declares context variable 'requestId'",
    );
  });
});

describe('detached — тотальный opt-out', () => {
  const policy = everyEndpoint().hasLayer(authedBase, 'authedBase');

  it('помеченная ручка исключается из проверки', () => {
    expect(
      policy.check([
        subject({
          pattern: 'GET /health',
          detached: 'liveness-проба: до auth не доходит',
        }),
      ]),
    ).toEqual([]);
  });

  it('непомеченная соседка по-прежнему нарушает', () => {
    const violations = policy.check([
      subject({
        pattern: 'GET /health',
        detached: 'liveness-проба: до auth не доходит',
      }),
      subject({ pattern: 'GET /metrics' }),
    ]);

    expect(violations.map((v) => v.pattern)).toEqual(['GET /metrics']);
  });
});
