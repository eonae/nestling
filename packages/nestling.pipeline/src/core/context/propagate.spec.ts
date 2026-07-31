/**
 * Провозимость переменной: флаг объявления, второй штатный писатель и сбор
 * значений из ячейки текущего запроса.
 *
 * Проверяется здесь ровно то, что принадлежит пайплайну; провоз через
 * границу порта — дело вызывателя и проверяется в `@nestling/ports`.
 */

import { declaresVar, makePipeline } from '../pipeline.js';
import type { ExtendableContext } from '../types/context.js';

import { makeCell, runInScope } from './store.js';
import {
  collectPropagatedContext,
  contextVar,
  propagatedKeys,
} from './variable.js';

import { describe, expect, it } from '@jest/globals';

const TenantId = contextVar<string>()('tenantId', { propagate: true });
const RequestId = contextVar<string>()('requestId');

const contextWith = (
  attributes: Record<string, unknown>,
): ExtendableContext<never> =>
  ({
    raw: { transport: 'bus', pattern: 'p', payload: {}, attributes },
  }) as unknown as ExtendableContext<never>;

describe('провозимая переменная', () => {
  it('несёт флаг объявления, а обычная — нет', () => {
    expect(TenantId.propagate).toBe(true);
    expect(RequestId.propagate).toBeUndefined();
  });

  it('попадает в реестр провозимых, а обычная — нет', () => {
    expect(propagatedKeys()).toContain('tenantId');
    expect(propagatedKeys()).not.toContain('requestId');
  });

  it('propagated() кладёт в input значение с провода', async () => {
    const unit = TenantId.propagated();

    expect(await unit(contextWith({ tenantId: 'acme' }))).toEqual({
      tenantId: 'acme',
    });
  });

  it('propagated() засчитывается как объявление переменной', () => {
    const layer = makePipeline().pre(TenantId.propagated());

    expect(declaresVar(layer, TenantId)).toBe(true);
  });

  it('provide поверх propagated побеждает — обычное накопление input', async () => {
    const propagated = TenantId.propagated();
    const local = TenantId.provide(() => 'local');

    expect(await propagated(contextWith({ tenantId: 'wire' }))).toEqual({
      tenantId: 'wire',
    });
    expect(await local(contextWith({}))).toEqual({ tenantId: 'local' });
  });

  it('propagated() у непровозимой переменной — внятный отказ', () => {
    expect(() =>
      (RequestId as unknown as { propagated: () => unknown }).propagated(),
    ).toThrow(/'requestId' is not propagated.*propagate: true/s);
  });

  it('вне запроса провозить нечего', () => {
    expect(collectPropagatedContext()).toBeUndefined();
  });

  it('в запросе собирает только провозимые переменные', () => {
    const cell = makeCell(new AbortController().signal, {
      tenantId: 'acme',
      requestId: 'req-1',
    });

    const collected = runInScope(cell, () => collectPropagatedContext());

    expect(collected).toEqual({ tenantId: 'acme' });
  });

  it('переменная, до которой pre-тракт не дошёл, не провозится', () => {
    const cell = makeCell(new AbortController().signal, { requestId: 'req-1' });

    expect(runInScope(cell, () => collectPropagatedContext())).toBeUndefined();
  });
});
