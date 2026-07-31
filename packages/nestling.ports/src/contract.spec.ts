import { makeContract } from './contract.js';
import { EmitterFamily, PortFamily } from './families.js';

import { defineFail } from '@nestling/pipeline';
import { z } from 'zod';

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
  details: z.object({ reason: z.string() }),
});

describe('makeContract', () => {
  it('объявляет request-контракт, ничего не регистрируя в приложении', () => {
    const ChargeCard = makeContract({
      name: 'spec.billing.charge',
      kind: 'request',
      input: z.object({ orderId: z.string(), amount: z.number() }),
      output: z.object({ chargeId: z.string() }),
      errors: [CardDeclined],
    });

    expect(ChargeCard.name).toBe('spec.billing.charge');
    expect(ChargeCard.kind).toBe('request');
    expect(ChargeCard.errors).toEqual([CardDeclined]);

    // Значение неизменяемо: контракт — данные, а не мутируемый билдер
    expect(Object.isFrozen(ChargeCard)).toBe(true);
  });

  it('даёт `.port` запросу и `.emitter` — команде и событию', () => {
    const Request = makeContract({
      name: 'spec.kinds.request',
      kind: 'request',
    });
    const Command = makeContract({
      name: 'spec.kinds.command',
      kind: 'command',
    });
    const Event = makeContract({ name: 'spec.kinds.event', kind: 'event' });

    expect(Request.port).toBe(PortFamily('spec.kinds.request'));
    expect(Command.emitter).toBe(EmitterFamily('spec.kinds.command'));
    expect(Event.emitter).toBe(EmitterFamily('spec.kinds.event'));
  });

  it('повторное обращение к вызывателю даёт тот же токен', () => {
    const Contract = makeContract({
      name: 'spec.identity.port',
      kind: 'request',
    });

    expect(Contract.port).toBe(Contract.port);
    expect(Contract.port).toBe(PortFamily('spec.identity.port'));
  });

  it('обращение к вызывателю чужого вида — ошибка с именем и видом', () => {
    const Event = makeContract({ name: 'spec.wrong.invoker', kind: 'event' });

    expect(() => (Event as unknown as { port: unknown }).port).toThrow(
      /'spec\.wrong\.invoker' is a 'event' contract.*use '\.emitter'/s,
    );

    const Request = makeContract({
      name: 'spec.wrong.invoker.request',
      kind: 'request',
    });

    expect(() => (Request as unknown as { emitter: unknown }).emitter).toThrow(
      /use '\.port'/,
    );
  });

  it('отвергает пустое имя', () => {
    expect(() => makeContract({ name: '', kind: 'event' })).toThrow(
      /'name' must be a non-empty string/,
    );
  });

  it('отвергает вид вне словаря, перечисляя допустимые', () => {
    expect(() =>
      makeContract({
        name: 'spec.bad.kind',
        kind: 'query' as unknown as 'request',
      }),
    ).toThrow(/'request', 'command', 'event'/);
  });

  it('отвергает элемент `errors:`, не созданный defineFail', () => {
    expect(() =>
      makeContract({
        name: 'spec.bad.errors',
        kind: 'request',
        // Функция без бренда `defineFail`: ровно та опечатка, которую ловит
        // проверка словаря
        errors: [((): void => undefined) as never],
      }),
    ).toThrow(/errors\[0] is not a fail definition/);
  });

  it('отвергает дубль кода в `errors:`, называя контракт и код', () => {
    expect(() =>
      makeContract({
        name: 'spec.duplicate.code',
        kind: 'request',
        errors: [CardDeclined, CardDeclined],
      }),
    ).toThrow(/Contract 'spec\.duplicate\.code'.*'CARD_DECLINED'/);
  });

  it('несёт флаг долговечности у события и у команды', () => {
    const placed = makeContract({
      name: 'spec.durable.placed',
      kind: 'event',
      durable: true,
    });
    const charge = makeContract({
      name: 'spec.durable.charge',
      kind: 'command',
      durable: true,
    });

    expect(placed.durable).toBe(true);
    expect(charge.durable).toBe(true);
  });

  it('контракт без флага долговечности его не несёт', () => {
    const plain = makeContract({ name: 'spec.durable.plain', kind: 'event' });

    expect('durable' in plain).toBe(false);
  });

  it('отвергает `durable` у request, называя контракт и вид', () => {
    expect(() =>
      makeContract({
        name: 'spec.durable.request',
        kind: 'request',
        // JS-потребителя типы не сдерживают: проверка обязана быть в рантайме
        durable: true as never,
      }),
    ).toThrow(/Contract 'spec\.durable\.request' \(kind 'request'\)/);
  });

  it('отвергает второй контракт с занятым именем', () => {
    makeContract({ name: 'spec.taken.name', kind: 'request' });

    expect(() =>
      makeContract({ name: 'spec.taken.name', kind: 'event' }),
    ).toThrow(/Contract 'spec\.taken\.name' is already declared/);
  });
});
