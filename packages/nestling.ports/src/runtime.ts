/**
 * `PortRuntime` — держатель исполнителей, наполняемый на фазе WIRE.
 *
 * Единственное позднее связывание в модели портов, и оно явное. Причина
 * фазовая: local-клиент исполняет вызов через `dispatch`, а `dispatch`
 * создаётся в WIRE — до него исполнимых endpoint'ов не существует ни у
 * кого. Значит клиент, инстанцированный на ASSEMBLE, физически не может
 * держать исполнитель, и окно «инстанцирован, но не связан» закрывается
 * ошибкой с понятным сообщением, а не молчаливым ожиданием.
 */

import type { IMessageBus } from './bus.js';

import type { Dispatch } from '@nestling/transport';

/** Диагностический отчёт вызывателя: то, что не попало на call-site */
export interface PortFailureInfo {
  /** Имя операции, на котором случился отказ */
  readonly contract: string;

  /** Оригинал: незадекларированный отказ, исключение или ответ границы */
  readonly error: unknown;
}

/** Исполнители, появляющиеся на WIRE */
export interface PortExecutors {
  /** Диспетчер транспорта шины; отсутствует, если шины в графе нет */
  readonly dispatch?: Dispatch;

  /** Шина; отсутствует, если ни одной реализации операции не собрано */
  readonly bus?: IMessageBus;
}

/** Держатель исполнителей local- и remote-биндинга */
export class PortRuntime {
  #executors?: PortExecutors;

  constructor(private readonly onFailure?: (info: PortFailureInfo) => void) {}

  /** Связан ли рантайм (фаза WIRE пройдена) */
  get bound(): boolean {
    return this.#executors !== undefined;
  }

  /**
   * Связывает вызыватели с исполнителями. Вызывается ровно один раз — в
   * фазе WIRE, после `makeDispatch` и до START.
   */
  bind(executors: PortExecutors): void {
    this.#executors = executors;
  }

  /**
   * Диспетчер шины для local-вызова.
   *
   * @throws {Error} Если вызов произошёл до фазы WIRE или транспорта шины
   * нет в графе
   */
  requireDispatch(contract: string): Dispatch {
    const executors = this.#requireBound(contract);

    if (!executors.dispatch) {
      throw new Error(
        `Port '${contract}' has no bus dispatch: the bus transport is not ` +
          `part of the assembled application. Declare the implementation ` +
          `with implement(${contract}, { … }) in 'endpoints:' of a module.`,
      );
    }

    return executors.dispatch;
  }

  /**
   * Шина для remote-вызова. `undefined` допустимо: эмиттер события без
   * подписчиков доставляет ноль раз, и шине там взяться неоткуда.
   *
   * @throws {Error} Если вызов произошёл до фазы WIRE
   */
  optionalBus(contract: string): IMessageBus | undefined {
    return this.#requireBound(contract).bus;
  }

  /** Диагностический канал: отказ, не попавший на call-site */
  report(info: PortFailureInfo): void {
    if (this.onFailure) {
      this.onFailure(info);
      return;
    }

    // eslint-disable-next-line no-console
    console.error(`[nestling] port '${info.contract}' failure:`, info.error);
  }

  #requireBound(contract: string): PortExecutors {
    if (!this.#executors) {
      throw new Error(
        `Port '${contract}' was called before phase 3 WIRE, where ports are ` +
          `bound to the bus dispatch. Executable handles do not exist before ` +
          `WIRE, so there is nothing to call yet: move the call to @OnStart ` +
          `or later (@OnInit is phase 2).`,
      );
    }

    return this.#executors;
  }
}
