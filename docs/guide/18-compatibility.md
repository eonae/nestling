# 17. Не сломать соседей при изменении операции

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-03).
> Целевое описание: [design/operations.md](../design/operations.md) §1.6 и
> §1.7. Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-07-31]
> Версионирование контрактов: снапшот, вердикт по слоту,
> третий вердикт `unknown`».

## Задача

Фичи разнесены по командам и процессам. Схема `quotas.claim` меняется в
одном репозитории, а вызывает её процесс, который выкатывается отдельно.
Нужно заметить несовместимое изменение операции в CI, до выкладки, и
знать, что с ним делать.

## Решение

### Версия входит в имя

Отдельного поля версии у операции нет. Несовместимая версия получает
новое имя: `quotas.claim.v2`. Имя операции служит адресом на шине, поэтому
старая и новая версии могут работать рядом, пока потребители переходят на
новую. Суффикс `.vN` фреймворк не требует и не разбирает; имя без версии
допустимо.

### Опишите операции сборки снапшотом

```typescript
// packages/examples.app-with-http/src/operations.compat.spec.ts
/** Варианты деплоя: снапшот объединяет то, что публикует каждый */
const TOPOLOGIES = [
  'all',
  { features: 'users', includeDeps: true },
  'ops',
] as const;

const BASELINE_PATH = new URL('../operations.snapshot.json', import.meta.url);

/** Baseline — обычный файл в репозитории */
const readBaseline = (): OperationSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as OperationSnapshot;

/** Текущий состав операций: матрица топологий, сведённая в снапшот */
const currentSnapshot = async (): Promise<OperationSnapshot> =>
  snapshotOperations(
    await checkTopologies(app, [...TOPOLOGIES], {
      converters: [zodConverter()],
    }),
  );
```

Источник описаний тот же, что в главе [16](./16-select.md): отчёт
`check()` каждой топологии содержит поле `operations` с дескрипторами
опубликованных операций. Дескриптор описывает имя, вид, формы `input` и
`output` и список отказов с кодами и статусами. Листовые схемы переводит
в JSON Schema конвертер вендора: тот же `zodConverter`, что строит
документ OpenAPI в главе [11](./11-openapi-and-client.md). Без
конвертера лист помечается непрозрачным, и сравнение по нему даёт
вердикт `unknown`.

`snapshotOperations(reports)` сводит матрицу в один снапшот
объединением. Каждая операция помнит, какие топологии её опубликовали:

```json
// packages/examples.app-with-http/operations.snapshot.json
{
  "snapshotVersion": 1,
  "operations": [
    {
      "name": "quotas.claim",
      "kind": "request",
      "input": {
        "kind": "value",
        "leaf": {
          "leaf": "schema",
          "vendor": "zod",
          "jsonSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "email": {
                "type": "string"
              }
            },
            "required": [
              "email"
            ],
            "type": "object"
          }
        }
      },
```

Объединение важно для матрицы: операция, которой нет в топологии `ops`,
принадлежит невыбранной фиче, а не удалена. Поле `topologies` у
`quotas.claim` содержит `all` и `users`, у `subscriptions.opened` только
`all` и `ops`.

Снапшот лежит в репозитории обычным файлом. `serializeSnapshot` даёт
детерминированный вывод: операции по имени, отказы по коду, ключи JSON
Schema отсортированы. Один и тот же граф даёт побайтово один и тот же
файл.

### Сравните с baseline в тесте

```typescript
// packages/examples.app-with-http/src/operations.compat.spec.ts
  it('текущая сборка совпадает с опубликованным снапшотом', async () => {
    const current = await currentSnapshot();

    if (process.env.UPDATE_SNAPSHOT) {
      writeFileSync(BASELINE_PATH, serializeSnapshot(current));
    }

    const report = diffOperations(readBaseline(), current);
    console.log(formatCompatibility(report));

    // Это проверка теста, а не фреймворка: осознанный breaking делается
    // сменой имени операции и перезаписью снапшота
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);

    // Снапшот детерминирован: файл побайтово равен сборке
    expect(serializeSnapshot(current)).toBe(
      readFileSync(BASELINE_PATH, 'utf8'),
    );
  });
```

`diffOperations(baseline, current)` сравнивает два снапшота и даёт
каждому расхождению ровно один вердикт. Отчёт содержит списки
`breaking`, `additive` и `unknown` с именем операции, JSON-путём и
описанием, а также сводку по операциям. `formatCompatibility(report)`
печатает отчёт для человека:

```
Operation compatibility: 0 breaking, 0 additive, 0 unknown
```

`diffOperations` не участвует в сборке и не бросает исключений из-за
результата сравнения. Что считать ошибкой, решает тест: здесь падает
любое расхождение, включая `additive`, чтобы каждое изменение операции
попадало в снапшот осознанно.

Вердикт зависит от слота. Схема `input` описывает то, что приходит в
реализацию, поэтому сужение принимаемого ломает вызывающих: новое
обязательное свойство, удалённое свойство, более узкий тип. Схема
`output` описывает то, что реализация обещает, поэтому ослабление
обещания ломает вызывающих: удалённое свойство, переход `required` в
`optional`. Всё, что правила не покрывают, получает `unknown`: незнакомые
ключевые слова JSON Schema, `oneOf` и `$ref`, смена вендора,
непрозрачный лист. `unknown` не означает «совместимо».

### Что показывает несовместимое изменение

```typescript
// packages/examples.app-with-http/src/operations.compat.spec.ts
    const report = diffOperations(baseline, current);

    expect(report.breaking).toMatchObject([
      {
        operation: 'quotas.claim',
        path: 'output.reservedUntil',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
    // Подсказка не переименовывает: операция адресуется прежним именем
    expect(report.operations).toContainEqual({
      operation: 'quotas.claim',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'quotas.claim.v2',
    });
```

Третий тест файла правит baseline, а не код: добавляет в `output`
операции `quotas.claim` обязательное поле `reservedUntil`. Так выглядел
бы снапшот до изменения, которым это поле убрали. Сравнение даёт одно
расхождение с вердиктом `breaking` и путём `output.reservedUntil`.
Операция с хотя бы одним `breaking` получает в сводке `suggestedName`.
Это единственное место, где суффикс `.vN` распознаётся; переименования не
происходит.

### Обновите baseline осознанно

Совместимое изменение, например новое необязательное поле в `output`,
даёт вердикт `additive`. Тест на него тоже падает, и это ожидаемый шаг:
перезапишите снапшот и закоммитьте его вместе с изменением операции.

```bash
UPDATE_SNAPSHOT=1 yarn workspace examples.app-with-http test src/operations.compat.spec.ts
```

Несовместимое изменение делается через новое имя. Объявите
`quotas.claim.v2` рядом с `quotas.claim`, реализуйте обе операции в фиче
`quotas`, переведите вызывающих на новую и удалите старую, когда
вызывающих не осталось. Снапшот обновляется на каждом шаге: сначала
появляется операция, потом исчезает старая. Удаление операции из
снапшота тест этого примера тоже считает ошибкой, потому что
`diffOperations` относит его к `breaking`.

## Что гарантирует фреймворк

- Один граф даёт побайтово один и тот же снапшот. Расхождение файла со
  сборкой означает изменение операций, а не порядка сериализации.
- Каждое расхождение получает ровно один вердикт. Непокрытое правилами
  изменение помечается `unknown`, а не пропускается как совместимое.
- `diffOperations` не бросает из-за результата сравнения. Единственное
  исключение: baseline с неизвестной `snapshotVersion`, это ошибка
  автора проверки.
- Снапшот строится из discovery, то есть из реализаций, которые
  топология публикует. Операция, объявленная, но не реализованная ни в
  одной топологии, в снапшот не попадает.

## Как проверить

Файл `operations.compat.spec.ts` целиком является проверкой этой главы.
Первый тест сравнивает сборку с baseline, второй проверяет объединение
топологий, третий показывает вердикт `breaking` на подготовленном
baseline.

```bash
yarn workspace examples.app-with-http test src/operations.compat.spec.ts
```

## Запускаемый код

| Файл | Что показывает |
|---|---|
| `packages/examples.app-with-http/src/operations.compat.spec.ts` | матрица с конвертером, снапшот, сравнение, обновление baseline |
| `packages/examples.app-with-http/operations.snapshot.json` | baseline в репозитории с полем `topologies` |
| `packages/examples.app-with-http/src/operations.ts` | операции, которые попадают в снапшот |

```bash
yarn workspace examples.app-with-http test src/operations.compat.spec.ts
UPDATE_SNAPSHOT=1 yarn workspace examples.app-with-http test src/operations.compat.spec.ts
```

## Дальше

Часть 4 закончена: приложение собирается в роли, разносится по процессам
и проверяет совместимость операций. Часть 5 читается по потребности,
начиная с webhook'а с проверкой подписи:
[19. Webhook с проверкой подписи](./19-webhook.md).
