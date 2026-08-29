/**
 * Фича как значение и резолвер выбора: транзитивное замыкание `dependsOn`,
 * формы `select` и fail-fast расхождений.
 */

import type { Feature } from './feature';
import { makeFeature, modulesOf, resolveSelection } from './feature';

import { describe, expect, it } from '@jest/globals';
import { makeModule } from '@nestling/container';

const moduleNamed = (name: string) => makeModule({ name });

const feature = (
  name: string,
  dependsOn: ReturnType<typeof makeFeature>[] = [],
) =>
  makeFeature({
    name,
    modules: [moduleNamed(`module:${name}`)],
    dependsOn,
  });

/** Имена выбранных фич — то, чем проверяется резолвер */
const namesOf = (features: ReturnType<typeof makeFeature>[]) =>
  features.map((selected) => selected.name);

describe('makeFeature', () => {
  it('возвращает значение без побочных эффектов', () => {
    const Orders = makeFeature({
      name: 'orders',
      modules: [moduleNamed('module:orders')],
    });

    expect(Orders.name).toBe('orders');
    expect(Orders.modules).toHaveLength(1);
    expect(Orders.dependsOn).toEqual([]);
    expect(Object.isFrozen(Orders)).toBe(true);
  });

  it('пустое имя — ошибка в момент объявления', () => {
    expect(() => makeFeature({ name: '', modules: [] })).toThrow(
      /'name' must be a non-empty string/,
    );
  });

  it('зависимость объявляется ссылкой на значение', () => {
    const Shared = feature('shared');
    const Orders = feature('orders', [Shared]);

    expect(Orders.dependsOn).toEqual([Shared]);
  });
});

describe('resolveSelection', () => {
  it('транзитивная зависимость подключается автоматически', () => {
    const Audit = feature('audit');
    const Shared = feature('shared', [Audit]);
    const Orders = feature('orders', [Shared]);

    expect(namesOf(resolveSelection([Orders], 'orders')).sort()).toEqual([
      'audit',
      'orders',
      'shared',
    ]);
  });

  it('зависимость, не перечисленная в features, участвует и выбирается по имени', () => {
    const Shared = feature('shared');
    const Orders = feature('orders', [Shared]);

    expect(namesOf(resolveSelection([Orders], 'shared'))).toEqual(['shared']);
  });

  it('взаимная зависимость не зацикливает выбор', () => {
    // Цикл легален: `dependsOn` описывает необходимость, а не порядок
    // построения. Значение `makeFeature` заморожено, поэтому связать фичи
    // в кольцо можно только собрав одну из них литералом.
    const Orders: Feature = {
      name: 'orders',
      modules: [moduleNamed('module:orders')],
      dependsOn: [],
    };

    const Billing = makeFeature({
      name: 'billing',
      modules: [moduleNamed('module:billing')],
      dependsOn: [Orders],
    });

    (Orders.dependsOn as Feature[]).push(Billing);

    expect(namesOf(resolveSelection([Orders], 'orders')).sort()).toEqual([
      'billing',
      'orders',
    ]);
  });

  it("'all' выбирает всё, включая транзитивно достижимое", () => {
    const Shared = feature('shared');
    const Orders = feature('orders', [Shared]);
    const Billing = feature('billing');

    expect(namesOf(resolveSelection([Orders, Billing], 'all')).sort()).toEqual([
      'billing',
      'orders',
      'shared',
    ]);
  });

  it('отсутствующий select равен all', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    expect(namesOf(resolveSelection([Orders, Billing])).sort()).toEqual([
      'billing',
      'orders',
    ]);
  });

  it('строка с запятыми и массив равнозначны, пробелы по краям игнорируются', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    expect(
      namesOf(resolveSelection([Orders, Billing], ' orders , billing ')),
    ).toEqual(['orders', 'billing']);
    expect(
      namesOf(resolveSelection([Orders, Billing], ['orders', 'billing'])),
    ).toEqual(['orders', 'billing']);
  });

  it('опечатка в имени — ошибка с перечнем доступных', () => {
    const Orders = feature('orders');
    const Billing = feature('billing');

    expect(() => resolveSelection([Orders, Billing], 'oders')).toThrow(
      /Unknown feature 'oders'.*Available features: orders, billing/s,
    );
  });

  it('две разные фичи с одним именем — ошибка', () => {
    const First = feature('orders');
    const Second = makeFeature({
      name: 'orders',
      modules: [moduleNamed('module:orders-2')],
    });

    expect(() => resolveSelection([First, Second], 'orders')).toThrow(
      /Two different features are named 'orders'/,
    );
  });

  it('пустой выбор — ошибка: «ничего» пишется отсутствием фич', () => {
    const Orders = feature('orders');

    expect(() => resolveSelection([Orders], '')).toThrow(/'select' is empty/);
    expect(() => resolveSelection([Orders], [])).toThrow(/'select' is empty/);
    expect(() => resolveSelection([Orders], ' , ')).toThrow(
      /'select' is empty/,
    );
  });

  it('select без features — ошибка', () => {
    expect(() => resolveSelection(undefined, 'orders')).toThrow(
      /'select' is given, but no features are declared/,
    );
    expect(() => resolveSelection([], 'orders')).toThrow(
      /'select' is given, but no features are declared/,
    );
  });

  it('без фич и без select выбор пуст', () => {
    expect(resolveSelection([])).toEqual([]);
  });
});

describe('modulesOf', () => {
  it('собирает модули выбранных фич, дедуплицируя по имени', () => {
    const Shared = moduleNamed('module:shared');

    const Orders = makeFeature({
      name: 'orders',
      modules: [Shared, moduleNamed('module:orders')],
    });

    const Billing = makeFeature({
      name: 'billing',
      modules: [Shared, moduleNamed('module:billing')],
    });

    expect(modulesOf([Orders, Billing]).map((module) => module.name)).toEqual([
      'module:shared',
      'module:orders',
      'module:billing',
    ]);
  });
});
