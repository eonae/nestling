# Типовые тесты Pipeline v2

Этот каталог содержит типовые тесты для проверки корректности типов
фазовой модели pipeline (`makePipeline`, слои, `compose`, `TNeeds`).

## Файлы

### `pipeline.spec.ts`

Единый файл с типовыми тестами, проверяющий:

- накопление input-полей через pre-тракт (монотонно, с детектом конфликтов);
- type-state билдера (`.pre` недоступен после первого ответного метода);
- честную типизацию ctx по фазам (`.ok` — полный, `.catch`/`.finally` —
  свой слой `Partial`, требования `TReq` — гарантированы);
- проверку требований слоёв в точке композиции (`compose`);
- `TNeeds`: класс-юнит блокирует исполнение до `bind()`;
- вывод типа меты хендлера (накопленный input без `payload` + `signal`).

## Как они работают

Проверка — на этапе компиляции TypeScript (jest в проекте гоняет tsc,
поэтому падение типов валит suite). Часть проверок дополнительно
выполняется в рантайме (рантайм-guard'ы билдера).

```bash
cd packages/nestling.pipeline
npx tsc --noEmit
```

### Паттерны

#### 1. Извлечение тип-параметров через фантомное поле `$types`

```typescript
type InferAcc<P> = P extends { $types?: PipelineTypes<any, infer A, any> }
  ? A
  : never;
type InferNeeds<P> = P extends { $types?: PipelineTypes<any, any, infer N> }
  ? N
  : never;
```

#### 2. Строгое равенство типов

```typescript
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

type _Identity = Expect<Equal<typeof ctx.input.identity, User | undefined>>;
```

#### 3. Негативные случаи — `@ts-expect-error`

```typescript
// @ts-expect-error: Pre-unit is overriding fields in input
pipeline.pre(addField({ userId: 42 }));
```

Если ошибка компиляции исчезнет (регрессия типовой машинерии), tsc
сообщит о неиспользованной директиве.

## Что проверяется

### ✅ Правильные комбинации

```typescript
makePipeline()
  .pre(withTiming)                      // TAcc: { timestamp }
  .pre(withIdentity<User>(auth))        // TAcc: { timestamp, identity }
  .pre(validate());                     // TAcc: { ..., payload }

compose(
  makePipeline().pre(withRequestId()),
  makePipeline<{ requestId: string }>().pre(withIdentity<User>(auth)),
);
```

### ❌ Неправильные комбинации (ошибки компиляции)

```typescript
// перезапись поля другим типом
makePipeline().pre(addField({ userId: 'abc' })).pre(addField({ userId: 42 }));

// юнит требует поле, которого ещё нет
makePipeline().pre(withPermissions(...)); // identity не добавлена

// pre после ответного метода
makePipeline().catch(u).pre(v);

// композиция без удовлетворения требований внутреннего слоя
compose(base, makePipeline<{ identity: User }>().pre(...));

// пайплайн с нерезолвленным классом-юнитом — транспорту нельзя
acceptsExecutable(makePipeline().pre(WithTracing));
```

## Добавление новых тестов

1. Добавьте тест в `pipeline.spec.ts` (группа по смыслу: accumulation /
   type-state / phase ctx / compose / TNeeds).
2. Для inline pre-юнитов используйте `addField()`.
3. Негативные случаи — через `@ts-expect-error` с текстом ожидаемой ошибки
   в комментарии.
4. Помните: `it`-блоки выполняются в рантайме — рантайм-guard'ы билдера
   (throw) оборачивайте в `expect(...).toThrow`.
