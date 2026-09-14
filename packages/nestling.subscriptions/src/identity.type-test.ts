/**
 * Типовые тесты источников `identity` и `labels`: форму накопленного
 * входа опция не пересказывает ни аннотацией, ни приведением.
 *
 * Файл не гоняется vitest'ом: он и есть тест — разойдись типы, упадёт `tsc`
 * на сборке пакета. Негативные случаи закрыты `@ts-expect-error`: исчезни
 * ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { computed } from './computed.js';
import type { IdentitySource, LabelsSource } from './registry.js';

import { contextVar, RequestId } from '@nestlingjs/app';

const UserId = contextVar<string>()('userId');
const TenantId = contextVar<number>()('tenantId');

/** Переменная ядра годится в `identity` как есть */
const byRequestId: IdentitySource = RequestId;

/** Прикладная переменная — тоже: ключ и тип значения несёт объявление */
const byUserId: IdentitySource = UserId;

/** Голая функция читает метаданные endpoint'а, а накопленный вход — нет */
const byTransport: LabelsSource = (ctx) => ({
  transport: ctx.endpoint.transport,
});

// @ts-expect-error: вход голой функции пуст, читать поле мимо переменных нечем
const byRawInput: IdentitySource = (ctx) => ctx.input.userId;

/** Значения `computed` типизированы объявлениями переменных */
const byTenantAndUser: IdentitySource = computed(
  [TenantId, UserId],
  (_ctx, tenant: number | undefined, user: string | undefined) =>
    user === undefined ? undefined : `${tenant}:${user}`,
);

// @ts-expect-error: `tenantId` объявлен числом — строкой его не прочитать
const wrongValueType = computed([TenantId], (_ctx, tenant: string) => tenant);

// @ts-expect-error: переменная-словарь метками не притворяется
const varAsLabels: LabelsSource = UserId;
