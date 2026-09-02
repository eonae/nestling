import { makeCommand, makeEvent, makeRequest } from './contract.js';
import { defineFail } from './define-fail.js';
import { EmitterFamily, PortFamily } from './families.js';

import { z } from 'zod';

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
  details: z.object({ reason: z.string() }),
});

describe('конструкторы операций', () => {
  it('объявляют запрос, ничего не регистрируя в приложении', () => {
    const ChargeCard = makeRequest({
      name: 'spec.billing.charge',
      input: z.object({ orderId: z.string(), amount: z.number() }),
      output: z.object({ chargeId: z.string() }),
      errors: [CardDeclined],
    });

    expect(ChargeCard.name).toBe('spec.billing.charge');
    expect(ChargeCard.kind).toBe('request');
    expect(ChargeCard.errors).toEqual([CardDeclined]);

    // Значение неизменяемо: операция — данные, а не мутируемый билдер
    expect(Object.isFrozen(ChargeCard)).toBe(true);
  });

  it('вид следует из конструктора, а не из поля', () => {
    const Request = makeRequest({ name: 'spec.kinds.request' });
    const Command = makeCommand({ name: 'spec.kinds.command' });
    const Event = makeEvent({ name: 'spec.kinds.event' });

    expect([Request.kind, Command.kind, Event.kind]).toEqual([
      'request',
      'command',
      'event',
    ]);
  });

  it('даёт `.caller` запросу и `.emitter` — команде и событию', () => {
    const Request = makeRequest({ name: 'spec.invokers.request' });
    const Command = makeCommand({ name: 'spec.invokers.command' });
    const Event = makeEvent({ name: 'spec.invokers.event' });

    expect(Request.caller).toBe(PortFamily('spec.invokers.request'));
    expect(Command.emitter).toBe(EmitterFamily('spec.invokers.command'));
    expect(Event.emitter).toBe(EmitterFamily('spec.invokers.event'));
  });

  it('повторное обращение к вызывателю даёт тот же токен', () => {
    const Operation = makeRequest({ name: 'spec.identity.caller' });

    expect(Operation.caller).toBe(Operation.caller);
    expect(Operation.caller).toBe(PortFamily('spec.identity.caller'));
  });

  it('обращение к вызывателю чужого вида — ошибка с именем и видом', () => {
    const Event = makeEvent({ name: 'spec.wrong.invoker' });

    expect(() => (Event as unknown as { caller: unknown }).caller).toThrow(
      /'spec\.wrong\.invoker' is a 'event'.*use '\.emitter'/s,
    );

    const Request = makeRequest({ name: 'spec.wrong.invoker.request' });

    expect(() => (Request as unknown as { emitter: unknown }).emitter).toThrow(
      /use '\.caller'/,
    );
  });

  it('отвергает пустое имя', () => {
    expect(() => makeEvent({ name: '' })).toThrow(
      /'name' must be a non-empty string/,
    );
  });

  it('отвергает элемент `errors:`, не созданный defineFail', () => {
    expect(() =>
      makeRequest({
        name: 'spec.bad.errors',
        // Функция без бренда `defineFail`: ошибка, которую ловит проверка
        // списка
        errors: [((): void => undefined) as never],
      }),
    ).toThrow(/errors\[0] is not a fail definition/);
  });

  it('отвергает дубль кода в `errors:`, называя операцию и код', () => {
    expect(() =>
      makeRequest({
        name: 'spec.duplicate.code',
        errors: [CardDeclined, CardDeclined],
      }),
    ).toThrow(/Operation 'spec\.duplicate\.code'.*'CARD_DECLINED'/);
  });

  it('несёт флаг долговечности у события и у команды', () => {
    const placed = makeEvent({ name: 'spec.durable.placed', durable: true });
    const charge = makeCommand({ name: 'spec.durable.charge', durable: true });

    expect(placed.durable).toBe(true);
    expect(charge.durable).toBe(true);
  });

  it('операция без флага долговечности его не несёт', () => {
    const plain = makeEvent({ name: 'spec.durable.plain' });

    expect('durable' in plain).toBe(false);
  });

  it('`durable` у запроса невыразим, а из JS отвергается рантаймом', () => {
    expect(() =>
      makeRequest({
        name: 'spec.durable.request',
        // @ts-expect-error — у запроса вызывающий ждёт ответа
        durable: true,
      }),
    ).toThrow(/Operation 'spec\.durable\.request' \(kind 'request'\)/);
  });

  it('`output` и `errors` у события невыразимы', () => {
    const withOutput = {
      name: 'spec.event.output',
      output: z.object({ ok: z.boolean() }),
    };

    // @ts-expect-error — у события нет ответа, который можно объявить
    expect(() => makeEvent(withOutput)).not.toThrow();
  });

  it('несёт секцию `doc` и отдаёт её вместе с интерфейсом операции', () => {
    const Create = makeRequest({
      name: 'spec.doc.create',
      doc: { summary: 'Create user', tags: ['users'], status: 'CREATED' },
    });

    expect(Create.doc).toEqual({
      summary: 'Create user',
      tags: ['users'],
      status: 'CREATED',
    });
  });

  it('операция без секции её не несёт', () => {
    const plain = makeEvent({ name: 'spec.doc.plain' });

    expect('doc' in plain).toBe(false);
  });

  it('проверяет `doc` теми же правилами, но называет операцию', () => {
    expect(() =>
      makeRequest({ name: 'spec.doc.broken', doc: { hidden: '' } }),
    ).toThrow(
      /Operation 'spec\.doc\.broken': 'doc\.hidden' must state a reason/,
    );

    expect(() =>
      makeRequest({
        name: 'spec.doc.status',
        doc: { status: 'PARTIAL_CONTENT' as never },
      }),
    ).toThrow(/Operation 'spec\.doc\.status': 'doc\.status' must be one of/);
  });

  it('отвергает вторую операцию с занятым именем', () => {
    makeRequest({ name: 'spec.taken.name' });

    expect(() => makeEvent({ name: 'spec.taken.name' })).toThrow(
      /'spec\.taken\.name' is already declared/,
    );
  });
});
