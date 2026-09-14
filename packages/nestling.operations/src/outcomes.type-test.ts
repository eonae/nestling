/**
 * Типовые тесты объявленных исходов: результат хендлера ограничен тем, что
 * объявила декларация, а развилка сужается по статусу.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативный случай закрыт `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { none, outputs } from './io/index.js';
import type { DeclaredOutputSync } from './output.js';
import { Ok } from './result.js';

import { z } from 'zod';

const User = z.object({ id: z.string(), email: z.string() });
type User = z.infer<typeof User>;

const JobAccepted = z.object({ jobId: z.string() });
type JobAccepted = z.infer<typeof JobAccepted>;

const user: User = { id: '1', email: 'a@b.co' };
const job: JobAccepted = { jobId: 'j-1' };

/** Декларация с одним исходом: объявленный статус */
type Created = DeclaredOutputSync<typeof User, never, 'created'>;

/** Декларация с развилкой: статусы объявлены её ключами */
const Outcomes = outputs({ ok: User, accepted: JobAccepted });
type Branching = DeclaredOutputSync<typeof Outcomes>;

/** Развилка с исходом без тела */
const WithEmpty = outputs({ ok: User, no_content: none() });
type WithEmptyOutcome = DeclaredOutputSync<typeof WithEmpty>;

/** Голое значение допустимо, пока исход один */
function bareValue(): Created {
  return user;
}

/** `Ok` объявленного исхода принимается */
function declaredOk(): Created {
  return Ok.created(user);
}

/** Статус вне объявленного множества не компилируется */
function foreignStatus(): Created {
  // @ts-expect-error объявлен исход 'created', а не 'accepted'
  return Ok.accepted(user);
}

/** Ветка развилки возвращает `Ok` своего исхода */
function okBranch(): Branching {
  return new Ok(user);
}

function acceptedBranch(): Branching {
  return Ok.accepted(job);
}

/** Тело ветки описано её схемой */
function wrongBranchValue(): Branching {
  // @ts-expect-error исход 'accepted' описан схемой JobAccepted
  return Ok.accepted(user);
}

/** При развилке голое значение не компилируется: исход выбирает ветка */
function bareValueBranching(): Branching {
  // @ts-expect-error развилка требует выбрать исход явно
  return user;
}

/** Исход `none()` не несёт тела */
function emptyOutcome(): WithEmptyOutcome {
  return Ok.noContent();
}

/** Проверка статуса сужает значение до типа своей ветки */
function narrowsByStatus(result: Branching): string {
  if (result instanceof Ok && result.status === 'accepted') {
    return result.value.jobId;
  }

  return result instanceof Ok && result.status === 'ok'
    ? result.value.email
    : 'failed';
}
