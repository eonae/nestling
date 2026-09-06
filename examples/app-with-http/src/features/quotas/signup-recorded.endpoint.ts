import type { SignupRecordedInput } from '../../operations.js';
import { SignupRecorded } from '../../operations.js';

import { SignupJournal } from './signup.journal.js';

import { implement, withIdempotencyKey } from '@nestling/app';
import { Injectable } from '@nestling/container';
import { makePipeline } from '@nestling/pipeline';

@Injectable([SignupJournal])
class SignupRecordedHandler {
  constructor(private readonly journal: SignupJournal) {}

  async handle(payload: SignupRecordedInput) {
    this.journal.record(payload.userId);
  }
}

/**
 * Реализация команды `quotas.record-signup`.
 *
 * Pre-юнит `withIdempotencyKey()` кладёт ключ в контекст, и сервис читает
 * его через `Ctx(IdempotencyKey)`. Что юнит есть в пайплайне, проверяет
 * политика в `root.ts`.
 */
export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: SignupRecordedHandler,
});
