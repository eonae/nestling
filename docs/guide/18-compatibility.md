# 18. Не сломать соседей при изменении операции

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-05).
> Целевое описание: [design/operations.md](../design/operations.md) §1.6 и
> §1.7. Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-07-31]
> Версионирование контрактов: снапшот, вердикт по слоту,
> третий вердикт `unknown`».

Фичи разнесены по командам и процессам. Схема `quotas.claim` меняется в
одном репозитории, а вызывает её процесс, который выкатывается отдельно.
Нужно заметить несовместимое изменение операции в CI, до выкладки, и
знать, что с ним делать.

Отдельного поля версии у операции нет. Несовместимая версия получает
новое имя: `quotas.claim.v2`. Имя операции служит адресом на шине, поэтому
старая и новая версии могут работать рядом, пока потребители переходят на
новую. Суффикс `.vN` фреймворк не требует и не разбирает, имя без версии
допустимо.

## Снапшот операций сборки

```typescript
// examples/app-with-http/src/operations.compat.spec.ts
/**
 * Та же декларация с секретами из объекта: `check()` собирает граф, и
 * секция читается
 */
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  policies: app.spec.policies,
  transports: app.spec.transports,
  config: [
    [
      objectSource(
        { API_TOKEN: 'test-token', WEBHOOK_SECRET: 'test-hook' },
        'test',
      ),
      appConfigKeys,
    ],
  ],
});

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
    await checkTopologies(checked, [...TOPOLOGIES], {
      converters: [zodConverter()],
    }),
  );
```

`checked` — та же декларация приложения, что и в главе
[16](./16-select.md): секреты привязаны источником к ключам секции, потому
что `check()` собирает граф и читает секцию конфига, а подстановок не
принимает. Источник описаний — отчёт `check()` каждой топологии из той же
главы: он содержит поле `operations` с дескрипторами опубликованных
операций. Дескриптор описывает имя, вид, формы `input` и `output` и
список отказов с кодами и категориями. Листовые схемы переводит в JSON
Schema конвертер вендора, тот же `zodConverter`, что строит документ
OpenAPI в главе [11](./11-openapi-and-client.md). Без конвертера лист
помечается непрозрачным, и сравнение по нему даёт вердикт `unknown`.

`snapshotOperations(reports)` сводит матрицу в один снапшот объединением.
Снапшот строится из discovery, то есть из реализаций, которые топология
публикует: операция, объявленная, но не реализованная ни в одной
топологии, в снапшот не попадает. Каждая опубликованная операция помнит,
какие топологии её опубликовали:

```json
// examples/app-with-http/operations.snapshot.json (фрагмент)
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
файл, поэтому расхождение файла со сборкой означает изменение операций, а
не порядка сериализации.

## Сравнение с baseline и вердикты

```typescript
// examples/app-with-http/src/operations.compat.spec.ts
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
каждому расхождению ровно один вердикт. Отчёт содержит списки `breaking`,
`additive` и `unknown` с именем операции, JSON-путём и описанием, а также
сводку по операциям. `formatCompatibility(report)` печатает отчёт для
человека:

```
Operation compatibility: 0 breaking, 0 additive, 0 unknown
```

`diffOperations` не участвует в сборке и не бросает исключений из-за
результата сравнения, кроме одного случая: baseline с неизвестной
`snapshotVersion` — это ошибка автора проверки. Что считать ошибкой теста,
решает сам тест: здесь падает любое расхождение, включая `additive`,
чтобы каждое изменение операции попадало в снапшот осознанно.

Вердикт зависит от слота. Схема `input` описывает то, что приходит в
реализацию, поэтому сужение принимаемого ломает вызывающих: новое
обязательное свойство, удалённое свойство, более узкий тип. Схема
`output` описывает то, что реализация обещает, поэтому ослабление
обещания ломает вызывающих: удалённое свойство, переход `required` в
`optional`. Всё, что правила не покрывают, получает `unknown`: незнакомые
ключевые слова JSON Schema, `oneOf` и `$ref`, смена вендора, непрозрачный
лист. `unknown` не означает «совместимо» и не пропускается как
совместимое.

Третий тест файла правит baseline, а не код: добавляет в `output`
операции `quotas.claim` обязательное поле `reservedUntil`. Так выглядел
бы снапшот до изменения, которым это поле убрали:

```typescript
// examples/app-with-http/src/operations.compat.spec.ts (фрагмент)
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

Сравнение даёт одно расхождение с вердиктом `breaking` и путём
`output.reservedUntil`. Операция с хотя бы одним `breaking` получает в
сводке `suggestedName`. Это единственное место, где суффикс `.vN`
распознаётся, переименования при этом не происходит.

## Обновите baseline осознанно

Совместимое изменение, например новое необязательное поле в `output`,
даёт вердикт `additive`. Тест на него тоже падает, и это ожидаемый шаг:
перезапишите снапшот и закоммитьте его вместе с изменением операции.

```bash
UPDATE_SNAPSHOT=1 yarn workspace @examples/app-with-http test src/operations.compat.spec.ts
```

Несовместимое изменение делается через новое имя. Объявите
`quotas.claim.v2` рядом с `quotas.claim`, реализуйте обе операции в фиче
`quotas`, переведите вызывающих на новую и удалите старую, когда
вызывающих не осталось. Снапшот обновляется на каждом шаге: сначала
появляется операция, потом исчезает старая. Удаление операции из снапшота
тест этого примера тоже считает ошибкой, потому что `diffOperations`
относит его к `breaking`.

```bash
yarn workspace @examples/app-with-http test src/operations.compat.spec.ts
```

Часть 4 закончена, а часть 5 читается по потребности — начиная с
webhook'а с проверкой подписи: [19. Webhook с проверкой
подписи](./19-webhook.md).
