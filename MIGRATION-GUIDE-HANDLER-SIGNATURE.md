# Migration Guide: Handler Signature Change

## Обзор

Изменена сигнатура метода `handle()` в интерфейсе `IEndpoint`. Теперь handler получает два отдельных параметра вместо одного объединённого объекта.

## Что изменилось

### До (старая версия)

```typescript
interface IEndpoint<I, O, P> {
  handle(input: ReplacePayload<P, InferInput<I>>): Output<InferOutput<O>>
}
```

Использование:
```typescript
async handle({ payload, identity }: { payload: CreateUserInput; identity?: User }) {
  // Доступ к payload через деструктуризацию
  const user = await this.users.create(payload);
  // Доступ к identity через деструктуризацию
  if (identity) {
    // ...
  }
}
```

### После (новая версия)

```typescript
interface IEndpoint<I, O, P> {
  handle(
    payload: InferInput<I>,
    meta: P extends { payload: unknown } ? Omit<P, 'payload'> : P
  ): Output<InferOutput<O>>
}
```

Использование:
```typescript
async handle(payload: CreateUserInput, meta: { identity?: User }) {
  // Прямой доступ к payload
  const user = await this.users.create(payload);
  // Доступ к метаданным через meta
  if (meta.identity) {
    // ...
  }
}
```

## Примеры миграции

### Пример 1: Endpoint с payload

**Было:**
```typescript
async handle({ payload }: { payload: CreateUserInput }): Output<CreateUserOutput> {
  const user = await this.users.create(payload);
  return Ok.created(user);
}
```

**Стало:**
```typescript
async handle(payload: CreateUserInput, meta: {}): Output<CreateUserOutput> {
  const user = await this.users.create(payload);
  return Ok.created(user);
}
```

### Пример 2: Endpoint без payload

**Было:**
```typescript
async handle(): Output<ListUsersOutput> {
  const users = await this.users.getAll();
  return users;
}
```

**Стало:**
```typescript
async handle(payload: undefined, meta: {}): Output<ListUsersOutput> {
  const users = await this.users.getAll();
  return users;
}
```

### Пример 3: Endpoint с метаданными из pipeline

**Было:**
```typescript
async handle({ payload, identity }: { 
  payload: CreateUserInput; 
  identity: User 
}): Output<CreateUserOutput> {
  // payload доступен напрямую
  const user = await this.users.create(payload);
  // identity доступен через деструктуризацию
  this.logger.log(`User ${identity.id} created ${user.id}`);
  return Ok.created(user);
}
```

**Стало:**
```typescript
async handle(
  payload: CreateUserInput, 
  meta: { identity: User }
): Output<CreateUserOutput> {
  // payload доступен напрямую
  const user = await this.users.create(payload);
  // identity доступен через meta
  this.logger.log(`User ${meta.identity.id} created ${user.id}`);
  return Ok.created(user);
}
```

### Пример 4: Endpoint с файлами (withFiles)

**Было:**
```typescript
async handle({ payload }): Output<UploadAvatarOutput> {
  const { data, files } = payload;
  // обработка файлов
}
```

**Стало:**
```typescript
async handle(
  payload: { data: UploadAvatarInput; files: FilePart[] },
  meta: {}
): Output<UploadAvatarOutput> {
  const { data, files } = payload;
  // обработка файлов
}
```

### Пример 5: Endpoint со streaming input

**Было:**
```typescript
async handle({ payload }: { 
  payload: AsyncIterableIterator<ImportUserInput> 
}): Output<ImportUsersOutput> {
  const result = await this.users.importUsers(payload);
  return Ok.success(result);
}
```

**Стало:**
```typescript
async handle(
  payload: AsyncIterableIterator<ImportUserInput>,
  meta: {}
): Output<ImportUsersOutput> {
  const result = await this.users.importUsers(payload);
  return Ok.success(result);
}
```

## Обновление тестов

### Unit тесты

**Было:**
```typescript
const result = await endpoint.handle({ payload: newUser });
```

**Стало:**
```typescript
const result = await endpoint.handle(newUser, {});
```

### Тесты с метаданными

**Было:**
```typescript
const result = await endpoint.handle({ 
  payload: newUser, 
  identity: mockUser 
});
```

**Стало:**
```typescript
const result = await endpoint.handle(newUser, { 
  identity: mockUser 
});
```

## Преимущества нового API

1. **Явное разделение**: бизнес-данные (payload) отделены от инфраструктурных метаданных (meta)
2. **Лучшая читаемость**: не нужна деструктуризация для доступа к payload
3. **Типобезопасность**: более явная типизация параметров
4. **Семантическая ясность**: сразу понятно, где данные от пользователя, а где от middleware

## Обратная совместимость

⚠️ **BREAKING CHANGE**: Это изменение ломает обратную совместимость!

Все существующие endpoint'ы необходимо обновить вручную. Автоматическая миграция невозможна из-за изменения сигнатуры метода.

## Чеклист миграции

- [ ] Обновить сигнатуру метода `handle()` во всех endpoint'ах
- [ ] Изменить деструктуризацию `{ payload }` на прямой параметр `payload`
- [ ] Переместить метаданные из деструктуризации в параметр `meta`
- [ ] Обновить все unit тесты endpoint'ов
- [ ] Обновить все e2e тесты (если они используют прямые вызовы handle)
- [ ] Обновить типы в интерфейсах, если они явно указаны
