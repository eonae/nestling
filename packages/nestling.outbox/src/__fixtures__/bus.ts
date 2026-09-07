/**
 * Шина-фикстура: публикация записывается, а не доставляется.
 *
 * Настоящая шина в тестах relay не нужна — проверяется то, что relay в неё
 * отдаёт: subject, payload, ключ идемпотентности и признак долговечности.
 */

import type {
  BusHandler,
  BusSubscription,
  IMessageBus,
  PublishOptions,
  ResponseContext,
} from '@nestling/app';

/** Одна публикация в том виде, в котором её сделал relay */
export interface PublishedMessage {
  readonly subject: string;
  readonly payload: unknown;
  readonly options?: PublishOptions;
}

/** Шина, которая копит публикации и умеет отказывать по требованию */
export class FakeBus implements IMessageBus {
  readonly remote = true;

  readonly durable = true;

  readonly published: PublishedMessage[] = [];

  /** Subject'ы, публикация которых заканчивается отказом */
  readonly failing = new Set<string>();

  /** Ставится тестом, чтобы задержать публикацию */
  gate?: Promise<void>;

  async request(): Promise<ResponseContext> {
    throw new Error('FakeBus.request is not used by the outbox relay');
  }

  async publish(
    subject: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    if (this.gate) {
      await this.gate;
    }

    if (this.failing.has(subject)) {
      throw new Error(`FakeBus: publish to '${subject}' failed`);
    }

    this.published.push({ subject, payload, options });
  }

  subscribe(_subject: string, _handler: BusHandler): BusSubscription {
    return { unsubscribe: (): void => undefined };
  }
}
