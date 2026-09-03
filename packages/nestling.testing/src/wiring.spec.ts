/**
 * Обвязка условия `"testing"` в репозитории.
 *
 * Тест обслуживает не пакет, а конфигурацию: если subpath перестанет
 * резолвиться на исходники или `await using` перестанет собираться,
 * узнать об этом надо здесь, а не в чужом падении через три change'а.
 */

import { assembleTest } from './app';

import { describe, expect, it } from '@jest/globals';
import { makeApp, makeFeature } from '@nestling/app';
import { wireApp } from '@nestling/app/testing';
import { BuiltContainer, Injectable, OnDestroy } from '@nestling/container';

describe('условие "testing" в тест-раннере', () => {
  it('резолвит @nestling/app/testing на исходники', async () => {
    const wired = await wireApp(
      makeApp({
        features: [makeFeature({ name: 'module:wiring' })],
      }),
    );

    // Класс из исходников `@nestling/container`: если бы subpath резолвился
    // в `dist`, он притащил бы вторую копию пакета, и `instanceof` не
    // сошёлся бы
    expect(wired.container).toBeInstanceOf(BuiltContainer);

    await wired.close();
  });

  it('вызывает Symbol.asyncDispose по выходу из блока `await using`', async () => {
    const events: string[] = [];

    @Injectable([])
    class Resource {
      @OnDestroy()
      release(): void {
        events.push('destroy');
      }
    }

    {
      await using app = await assembleTest(
        makeApp({
          features: [
            makeFeature({ name: 'module:disposable', providers: [Resource] }),
          ],
        }),
      );

      expect(app.get(Resource)).toBeInstanceOf(Resource);
      expect(events).toEqual([]);
    }

    expect(events).toEqual(['destroy']);
  });
});
