/**
 * Обвязка условия `"testing"` в репозитории.
 *
 * Тест обслуживает не пакет, а конфигурацию: если subpath перестанет
 * резолвиться на исходники или `await using` перестанет собираться,
 * узнать об этом надо здесь, а не в чужом падении через три change'а.
 */

import { assembleTest } from './app.js';

import { describe, expect, it } from '@jest/globals';
import { makeApp, makeFeature } from '@nestlingjs/app';
import { wireApp } from '@nestlingjs/app/testing';
import { BuiltContainer, Resource } from '@nestlingjs/container';

describe('условие "testing" в тест-раннере', () => {
  it('резолвит @nestlingjs/app/testing на исходники', async () => {
    const wired = await wireApp(
      makeApp({
        features: [makeFeature({ name: 'module:wiring' })],
      }),
    );

    // Класс из исходников `@nestlingjs/container`: если бы subpath резолвился
    // в `dist`, он притащил бы вторую копию пакета, и `instanceof` не
    // сошёлся бы
    expect(wired.container).toBeInstanceOf(BuiltContainer);

    await wired.close();
  });

  it('вызывает Symbol.asyncDispose по выходу из блока `await using`', async () => {
    const events: string[] = [];

    @Resource([])
    class Disposable {
      static async acquire(_signal: AbortSignal): Promise<Disposable> {
        return new Disposable();
      }

      release(): void {
        events.push('destroy');
      }
    }

    {
      await using app = await assembleTest(
        makeApp({
          features: [
            makeFeature({
              name: 'module:disposable',
              providers: [Disposable],
            }),
          ],
        }),
      );

      expect(app.get(Disposable)).toBeInstanceOf(Disposable);
      expect(events).toEqual([]);
    }

    expect(events).toEqual(['destroy']);
  });
});
