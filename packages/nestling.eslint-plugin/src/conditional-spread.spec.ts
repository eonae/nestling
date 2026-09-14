/**
 * `conditional-spread`: какие формы правило переписывает, где проходит
 * граница автофикса и где правило молчит.
 *
 * Граница автофикса — главное в таблице: он применяется к булевому по
 * форме итогу, то есть к тому выражению, что встаёт слева от `&&`.
 * Поэтому пары «тот же тест, другая пустая ветвь» стоят рядом: у них
 * разные итоги и разный исход.
 */

import { conditionalSpread } from './conditional-spread.js';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

// `RuleTester` объявляет кейсы через `describe`/`it`, и берёт он их отсюда:
// глобалов у прогона нет, а без этой пары кейсы исполнились бы мимо раннера
// и файл сошёл бы за пустой
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('conditional-spread', conditionalSpread, {
  valid: [
    {
      name: 'спред в литерале массива: замена бросала бы TypeError',
      code: 'const list = [...(ready ? items : [])];',
    },
    {
      name: 'связка в литерале массива тоже не разбирается',
      code: 'const list = [...(ready && items)];',
    },
    {
      name: 'обе ветви пустые — предлагать нечего',
      code: 'const options = { ...(ready ? {} : {}) };',
    },
    {
      name: 'обе ветви непустые — форма не та',
      code: 'const options = { ...(ready ? { retry: true } : { retry: false }) };',
    },
    {
      name: 'связка с булевым тестом — искомая форма',
      code: 'const options = { ...(port !== undefined && { port }) };',
    },
    {
      name: 'связка сравнений булева обеими сторонами',
      code: 'const options = { ...(a === 1 && b !== 2 && { flag: true }) };',
    },
    {
      name: 'приведение вызовом Boolean булево по форме',
      code: 'const options = { ...(Boolean(port) && { port }) };',
    },
    {
      name: 'отрицание булево по форме',
      code: 'const options = { ...(!ready && { retry: true }) };',
    },
    {
      name: 'безусловная примесь',
      code: 'const options = { ...base, port: 3000 };',
    },
  ],

  invalid: [
    {
      name: 'пустая ветвь вторая: тест идёт слева от связки как есть',
      code: 'const options = { ...(port !== undefined ? { port } : {}) };',
      output: 'const options = { ...(port !== undefined && { port }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'пустая ветвь первая: равенство инвертируется оператором',
      code: 'const options = { ...(port === undefined ? {} : { port }) };',
      output: 'const options = { ...(port !== undefined && { port }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'нестрогое равенство инвертируется так же',
      code: 'const options = { ...(value == null ? {} : { value }) };',
      output: 'const options = { ...(value != null && { value }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'реляционное сравнение оборачивается отрицанием',
      code: 'const options = { ...(size < limit ? {} : { size }) };',
      output: 'const options = { ...(!(size < limit) && { size }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'связка сравнений встаёт слева без скобок',
      code: 'const options = { ...(a === 1 && b !== 2 ? { flag: true } : {}) };',
      output: 'const options = { ...(a === 1 && b !== 2 && { flag: true }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'дизъюнкция слева от связки берётся в скобки',
      code: 'const options = { ...(a === 1 || b === 2 ? { flag: true } : {}) };',
      output:
        'const options = { ...((a === 1 || b === 2) && { flag: true }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'идентификатор в тесте: итог небулев, фикса нет',
      code: 'const options = { ...(ready ? { retry: true } : {}) };',
      output: null,
      errors: [{ messageId: 'ternaryByHand' }],
    },
    {
      name: 'тот же идентификатор с пустой первой ветвью: итог — отрицание, фикс есть',
      code: 'const options = { ...(ready ? {} : { retry: true }) };',
      output: 'const options = { ...(!ready && { retry: true }) };',
      errors: [{ messageId: 'ternary' }],
    },
    {
      name: 'отрицание идентификатора: внешнее ! снимается, итог небулев',
      code: 'const options = { ...(!ready ? {} : { retry: true }) };',
      output: null,
      errors: [{ messageId: 'ternaryByHand' }],
    },
    {
      name: 'слияние с нулевым значением булевым не считается',
      code: 'const options = { ...(port ?? fallback ? { port } : {}) };',
      output: null,
      errors: [{ messageId: 'ternaryByHand' }],
    },
    {
      name: 'ловушка нуля: сообщение с suggestion, автофикса нет',
      code: 'const options = { ...(httpPort && { port: httpPort }) };',
      output: null,
      errors: [
        {
          messageId: 'truthyTest',
          data: { comparison: 'httpPort !== undefined' },
          suggestions: [
            {
              messageId: 'compareExplicitly',
              data: { comparison: 'httpPort !== undefined' },
              output:
                'const options = { ...(httpPort !== undefined && { port: httpPort }) };',
            },
          ],
        },
      ],
    },
    {
      name: 'ловушка в цепочке: скобки ставятся по приоритету',
      code: 'const options = { ...(mask & flag && { masked: true }) };',
      output: null,
      errors: [
        {
          messageId: 'truthyTest',
          suggestions: [
            {
              messageId: 'compareExplicitly',
              output:
                'const options = { ...((mask & flag) !== undefined && { masked: true }) };',
            },
          ],
        },
      ],
    },
  ],
});
