## MODIFIED Requirements

### Requirement: Фича — тип слоя приложения, содержащий модули

Фича SHALL быть значением с полями `name`, необязательным `endpoints` и
ровно одной из двух форм состава: `providers` или `modules`. Обе формы
одновременно SHALL быть ошибкой типа.

Списки `providers`, `modules` и `endpoints` SHALL принимать ветки
переключателей наравне со своими элементами (capability
`composition-switches`). Ветка SHALL раскрываться на фазе ASSEMBLE, до
discovery: невыбранная ветка отсутствует в приложении так же, как
невыбранная фича.

Фича SHALL объявляться конструктором `makeFeature`. Она SHALL NOT наследовать
`Module`: она содержит модули, а не расширяет их тип.

Поля `dependsOn` у фичи SHALL NOT существовать. Зависимость одной фичи от
другой SHALL выводиться из объявленных операций: вызывающая сторона названа
в `deps` декларации, реализация — в составе другой фичи.

Создание фичи SHALL NOT иметь побочных эффектов: глобального реестра фич
SHALL NOT существовать.

#### Scenario: Плоская фича

- **WHEN** объявлена фича `{ name: 'users', providers: [UserService], endpoints: [CreateUser] }`
- **THEN** значение принимается, а узлы провайдеров несут метку `'users'`

#### Scenario: Составная фича

- **WHEN** объявлена фича `{ name: 'users', modules: [UsersCore, UsersApi] }`
- **THEN** значение принимается, а узлы несут метки своих модулей

#### Scenario: Фича с веткой в составе

- **WHEN** объявлена фича `{ name: 'uploads', modules: [StorageModule, Debug.when(DebugModule)] }`
- **THEN** при `debug=off` в графе нет ни одного провайдера `DebugModule`,
  а список модулей фичи содержит один модуль

#### Scenario: Обе формы одновременно отвергаются

- **WHEN** объявлена фича с `providers` и `modules` сразу
- **THEN** компилятор отвергает объявление

#### Scenario: Фича — обычное значение

- **WHEN** объявлено `makeFeature({ name: 'orders', modules: [OrdersModule] })`,
  значение экспортировано и помещено в массив
- **THEN** побочных эффектов нет: ни один модуль не зарегистрирован, пока
  фича не выбрана в composition root
