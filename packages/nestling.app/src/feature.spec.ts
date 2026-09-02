/**
 * Фича и плагин как значения плюс резолвер выбора: формы состава, правила
 * ролей и fail-fast расхождений.
 */

import type { Feature } from './feature';
import {
  makeFeature,
  makePlugin,
  modulesOf,
  reachablePlugins,
  resolveSelection,
} from './feature';

import { describe, expect, it } from '@jest/globals';
import { makeModule } from '@nestling/container';

const moduleNamed = (name: string) => makeModule({ name });

const feature = (name: string) =>
  makeFeature({ name, modules: [moduleNamed(`module:${name}`)] });

/** Имена выбранных фич — то, чем проверяется резолвер */
const namesOf = (features: readonly Feature[]) =>
  features.map((selected) => selected.name);

describe('makeFeature', () => {
  it('плоская форма: провайдеры получают меткой имя фичи', () => {
    const Users = makeFeature({ name: 'users', providers: [] });

    expect(Users.role).toBe('feature');
    expect(Users.modules).toHaveLength(1);
    expect(Users.modules[0]?.name).toBe('users');
    expect(Object.isFrozen(Users)).toBe(true);
  });

  it('составная форма: узлы несут метки своих модулей', () => {
    const Users = makeFeature({
      name: 'users',
      modules: [
        moduleNamed('module:users-core'),
        moduleNamed('module:users-api'),
      ],
    });

    expect(Users.modules.map(({ name }) => name)).toEqual([
      'module:users-core',
      'module:users-api',
    ]);
  });

  it('обе формы сразу — ошибка объявления', () => {
    const bothForms = {
      name: 'users',
      providers: [],
      modules: [moduleNamed('module:users')],
    };

    // @ts-expect-error — у состава один источник истины
    expect(() => makeFeature(bothForms)).toThrow(
      /either 'providers' or 'modules', not both/,
    );
  });

  it('единица только с endpoint’ами законна', () => {
    const Ops = makeFeature({ name: 'ops', endpoints: [] });

    expect(Ops.modules).toEqual([]);
    expect(Ops.endpoints).toEqual([]);
  });

  it('пустое имя — ошибка в момент объявления', () => {
    expect(() => makeFeature({ name: '', providers: [] })).toThrow(
      /'name' must be a non-empty string/,
    );
  });

  it('поля dependsOn у фичи нет', () => {
    const Users = feature('users');

    expect('dependsOn' in Users).toBe(false);
  });
});

describe('makePlugin', () => {
  it('несёт роль, состав и ссылки на другие плагины', () => {
    const Shared = makePlugin({ name: '@acme/shared', providers: [] });
    const Logging = makePlugin({
      name: '@acme/logging',
      providers: [],
      dependsOn: [Shared],
    });

    expect(Logging.role).toBe('plugin');
    expect(Logging.dependsOn).toEqual([Shared]);
  });

  it('фичу в dependsOn не принимает', () => {
    const Users = feature('users');

    expect(() =>
      makePlugin({
        name: '@acme/logging',
        providers: [],
        // @ts-expect-error — инфраструктура не зависит от бизнес-логики
        dependsOn: [Users],
      }),
    ).toThrow(/accepts plugins only/);
  });

  it('замыкание по dependsOn даёт каждый плагин один раз', () => {
    const Shared = makePlugin({ name: '@acme/shared', providers: [] });
    const Left = makePlugin({
      name: '@acme/left',
      providers: [],
      dependsOn: [Shared],
    });
    const Right = makePlugin({
      name: '@acme/right',
      providers: [],
      dependsOn: [Shared],
    });

    expect(reachablePlugins([Left, Right]).map(({ name }) => name)).toEqual([
      '@acme/shared',
      '@acme/left',
      '@acme/right',
    ]);
  });
});

describe('modulesOf', () => {
  it('дедуплицирует по ссылке', () => {
    const Shared = moduleNamed('module:shared');
    const Left = makeFeature({ name: 'left', modules: [Shared] });
    const Right = makeFeature({ name: 'right', modules: [Shared] });

    expect(modulesOf([Left, Right])).toEqual([Shared]);
  });

  it('роняет сборку на двух разных значениях под одним именем', () => {
    const Left = makeFeature({
      name: 'left',
      modules: [makeModule({ name: 'module:shared' })],
    });
    const Right = makeFeature({
      name: 'right',
      modules: [makeModule({ name: 'module:shared' })],
    });

    expect(() => modulesOf([Left, Right])).toThrow(
      /Two different modules are named 'module:shared'/,
    );
  });
});

describe('resolveSelection', () => {
  it('без select выбраны все объявленные фичи', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    expect(namesOf(resolveSelection([Orders, Billing]).features)).toEqual([
      'orders',
      'billing',
    ]);
  });

  it('строковая форма режется по запятой', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    const { features } = resolveSelection([Orders, Billing], 'billing, orders');

    expect(namesOf(features)).toEqual(['billing', 'orders']);
  });

  it('объектная форма несёт includeDeps', () => {
    const Orders = feature('orders');

    const { features, includeDeps } = resolveSelection([Orders], {
      features: 'orders',
      includeDeps: true,
    });

    expect(namesOf(features)).toEqual(['orders']);
    expect(includeDeps).toBe(true);
  });

  it('транзитивного замыкания по объявленному полю нет', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    // Выбор строгий: `billing` не подтягивается ничем, кроме `includeDeps`
    expect(
      namesOf(resolveSelection([Orders, Billing], 'orders').features),
    ).toEqual(['orders']);
  });

  it('неизвестное имя называет доступные', () => {
    const Orders = feature('orders');

    expect(() => resolveSelection([Orders], 'nope')).toThrow(
      /Unknown feature 'nope' in 'select'\. Available features: orders\./,
    );
  });

  it('одноимённые разные фичи — ошибка словаря выбора', () => {
    expect(() =>
      resolveSelection([feature('orders'), feature('orders')]),
    ).toThrow(/Two different features are named 'orders'/);
  });

  it('пустой выбор — ошибка с объяснением, как записать «ничего»', () => {
    expect(() => resolveSelection([feature('orders')], '')).toThrow(
      /'select' is empty/,
    );
  });

  it('select без features — ошибка', () => {
    expect(() => resolveSelection([], 'orders')).toThrow(
      /'select' is given, but no features are declared/,
    );
  });
});
