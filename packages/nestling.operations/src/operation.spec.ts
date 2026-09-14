import { none, outputs, stream } from './io/index.js';
import { EmitterFamily, PortFamily } from './families.js';
import { makeFail } from './make-fail.js';
import { errorsOf, makeCommand, makeEvent, makeRequest } from './operation.js';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const CardDeclined = makeFail('payment_required:card_declined', {
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

  it('повторное обращение к вызывателю даёт тот же DI-токен', () => {
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

  it('отвергает элемент `errors:`, не созданный makeFail', () => {
    expect(() =>
      makeRequest({
        name: 'spec.bad.errors',
        // Функция без бренда `makeFail`: ошибка, которую ловит проверка
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
    ).toThrow(
      /Operation 'spec\.duplicate\.code'.*'payment_required:card_declined'/,
    );
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
      doc: { summary: 'Create user', tags: ['users'] },
    });

    expect(Create.doc).toEqual({
      summary: 'Create user',
      tags: ['users'],
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
        doc: { status: 'created' } as never,
      }),
    ).toThrow(
      /Operation 'spec\.doc\.status': 'doc\.status' is not a field of the documentation section/,
    );
  });

  it('отвергает вторую операцию с занятым именем', () => {
    makeRequest({ name: 'spec.taken.name' });

    expect(() => makeEvent({ name: 'spec.taken.name' })).toThrow(
      /'spec\.taken\.name' is already declared/,
    );
  });
});

describe('errorsOf', () => {
  it('отдаёт объявленные отказы тем же массивом', () => {
    const ClaimQuota = makeRequest({
      name: 'spec.errors-of.claim-quota',
      errors: [CardDeclined],
    });

    expect(errorsOf(ClaimQuota)).toEqual([CardDeclined]);
    expect(errorsOf(ClaimQuota)[0]).toBe(CardDeclined);
  });

  it('операция без `errors:` даёт пустой список', () => {
    const Plain = makeRequest({ name: 'spec.errors-of.plain' });

    expect(errorsOf(Plain)).toEqual([]);
  });
});

describe('объявление успешных исходов', () => {
  const User = z.object({ id: z.string() });
  const Job = z.object({ jobId: z.string() });

  it('запрос несёт объявленный статус на значении', () => {
    const Create = makeRequest({
      name: 'spec.status.created',
      output: User,
      status: 'created',
    });

    expect(Create.status).toBe('created');
  });

  it('операция без поля его не несёт: умолчание считает потребитель', () => {
    const List = makeRequest({ name: 'spec.status.absent', output: User });

    expect('status' in List).toBe(false);
  });

  it('развилка исходов лежит в слоте `output` как есть', () => {
    const form = outputs({ ok: User, accepted: Job });
    const Create = makeRequest({ name: 'spec.status.outcomes', output: form });

    expect(Create.output).toBe(form);
  });

  it('отвергает статус вне словаря ядра', () => {
    expect(() =>
      makeRequest({
        name: 'spec.status.unknown',
        output: User,
        status: 'partial_content' as never,
      }),
    ).toThrow(
      /Operation 'spec\.status\.unknown': 'status' must be one of 'ok', 'created', 'accepted', 'no_content'/,
    );
  });

  it('отвергает список статусов, называя развилку', () => {
    expect(() =>
      makeRequest({
        name: 'spec.status.list',
        output: User,
        status: ['ok', 'created'] as never,
      }),
    ).toThrow(
      /takes one status, not a list.*outputs\({ ok: …, accepted: … }\)/s,
    );
  });

  it('отвергает числовой код', () => {
    expect(() =>
      makeRequest({
        name: 'spec.status.code',
        output: User,
        status: 201 as never,
      }),
    ).toThrow(/not an HTTP code — the number is chosen by the transport/);
  });

  it('отвергает `no_content` при объявленном выходе', () => {
    expect(() =>
      makeRequest({
        name: 'spec.status.no-content',
        output: User,
        status: 'no_content',
      }),
    ).toThrow(/promises a body by a schema/);
  });

  it('отвергает пустую развилку и развилку из одного ключа', () => {
    expect(() =>
      makeRequest({ name: 'spec.outcomes.empty', output: outputs({}) }),
    ).toThrow(/without a single outcome/);

    expect(() =>
      makeRequest({
        name: 'spec.outcomes.single',
        output: outputs({ created: User }),
      }),
    ).toThrow(/with a single outcome.*'status: 'created''/s);
  });

  it('отвергает ключ развилки вне словаря статусов', () => {
    expect(() =>
      makeRequest({
        name: 'spec.outcomes.unknown-key',
        output: outputs({ ok: User, partial_content: Job } as never),
      }),
    ).toThrow(/the key 'partial_content' of outputs\({ … }\) must be one of/);
  });

  it('отвергает `status` вместе с развилкой', () => {
    expect(() =>
      makeRequest({
        name: 'spec.outcomes.with-status',
        output: outputs({ ok: User, created: User }),
        status: 'created' as never,
      }),
    ).toThrow(/already names the statuses with its keys/);
  });

  it('отвергает потоковую форму веткой развилки и называет причину', () => {
    expect(() =>
      makeRequest({
        name: 'spec.outcomes.stream',
        output: outputs({ ok: stream(User), no_content: none() } as never),
      }),
    ).toThrow(/streaming form is declared as the only outcome/);
  });

  it('отвергает `none()` вне развилки', () => {
    expect(() =>
      makeRequest({ name: 'spec.outcomes.none', output: none() as never }),
    ).toThrow(/only valid inside outputs\({ … }\)/);
  });

  it('отвергает исход у команды и у события', () => {
    expect(() =>
      makeCommand({
        name: 'spec.outcomes.command',
        status: 'accepted' as never,
      }),
    ).toThrow(
      /Operation 'spec\.outcomes\.command' \(kind 'command'\): 'status' declares a successful outcome, and this kind has no reply to carry it/,
    );

    expect(() =>
      makeEvent({
        name: 'spec.outcomes.event',
        output: outputs({ ok: User, created: User }),
      } as never),
    ).toThrow(
      /\(kind 'event'\): outputs\({ … }\) declares a successful outcome, and this kind has no reply to carry it/,
    );
  });
});
