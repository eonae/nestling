/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты: предмет проверки — множество объявленных переменных, а не
 * их эффект */
/**
 * Множество ambient-переменных, объявленных пайплайном.
 *
 * Живёт по тем же правилам, что провенанс композиции, и проверяется так
 * же: композиция объединяет, деривация сохраняет и не мутирует исходный
 * слой, `bind()` сохраняет. Отдельно — граница декларации: объявителем
 * считается форма `<Var>.provide(…)`, а не факт появления поля в input.
 */

import { contextVar } from './context/variable.js';
import type { Pipeline } from './pipeline.js';
import { compose, declaresVar, makePipeline } from './pipeline.js';

import { describe, expect, it } from '@jest/globals';
import type { EmptyInput } from '@nestling/contracts';

const RequestId = contextVar<string>()('requestId');
const TenantId = contextVar<string>()('tenantId');

describe('множество объявленных переменных', () => {
  it('пустой слой не объявляет ничего', () => {
    expect(declaresVar(makePipeline(), RequestId)).toBe(false);
  });

  it('pre с writer-юнитом объявляет переменную', () => {
    const layer = makePipeline().pre(RequestId.provide(() => 'req-1'));

    expect(declaresVar(layer, RequestId)).toBe(true);
    expect(declaresVar(layer, TenantId)).toBe(false);
  });

  it('composition объединяет объявления аргументов', () => {
    const observability = makePipeline().pre(RequestId.provide(() => 'req-1'));
    const tenancy = makePipeline().pre(TenantId.provide(() => 'acme'));

    const pipeline = compose(observability, tenancy);

    expect(declaresVar(pipeline, RequestId)).toBe(true);
    expect(declaresVar(pipeline, TenantId)).toBe(true);
  });

  it('деривация сохраняет объявления и не меняет исходный слой', () => {
    const observability = makePipeline().pre(RequestId.provide(() => 'req-1'));

    const extended = observability.pre(TenantId.provide(() => 'acme'));

    expect(declaresVar(extended, RequestId)).toBe(true);
    expect(declaresVar(extended, TenantId)).toBe(true);
    // Значение иммутабельно: исходный слой производным не «заразился»
    expect(declaresVar(observability, TenantId)).toBe(false);
  });

  it('bind сохраняет множество несвязанного оригинала', () => {
    class TrackUnit {
      handle(): void {}
    }

    const layer = makePipeline()
      .pre(RequestId.provide(() => 'req-1'))
      .pre(TrackUnit);

    const bound = (layer as unknown as Pipeline<EmptyInput>).bind(
      () => new TrackUnit(),
    );

    expect(declaresVar(bound, RequestId)).toBe(true);
  });

  it('юнит, кладущий поле вручную, объявителем не считается', () => {
    const manual = makePipeline().pre(async () => ({ requestId: 'req-1' }));

    expect(declaresVar(manual, RequestId)).toBe(false);
  });

  it('переменная-омоним из другого вызова contextVar не считается', () => {
    const other = contextVar<string>()('requestId');
    const layer = makePipeline().pre(RequestId.provide(() => 'req-1'));

    expect(declaresVar(layer, other)).toBe(false);
  });

  it('не-пайплайн и не-переменная предикату не подходят', () => {
    expect(declaresVar({}, RequestId)).toBe(false);
    expect(declaresVar(makePipeline(), 'requestId')).toBe(false);
  });
});
