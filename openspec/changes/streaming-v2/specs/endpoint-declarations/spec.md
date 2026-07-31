# endpoint-declarations

## MODIFIED Requirements

### Requirement: Конструктор декларации проверяет транспортный словарь при создании

Конструктор SHALL проверять словарь немедленно при создании значения — до
сборки приложения — и SHALL бросать ошибку, называющую нарушенное правило и
проблемное значение. `httpEndpoint` SHALL отвергать пустой `path`, `path`,
не начинающийся с `/`, и повторяющиеся имена path-параметров в шаблоне.
`cliEndpoint` SHALL отвергать пустое имя команды.

К этому набору SHALL добавляться проверки bind-карты (правила и тексты —
capability `http-input-binding`): пометка на поле-path-параметре, `body()`
у метода без тела, `bind` или path-параметр при неструктурном `input`,
path-параметр при отсутствии `input`, `rawBody` при потоковых и
multipart-формах.

К этому же набору SHALL относиться проверка списка `errors:` (правила и
тексты — capability `endpoint-error-contract`): элемент, не являющийся
определением `defineFail`, и повторяющийся `code` SHALL быть ошибкой в
момент создания декларации.

К этому же набору SHALL относиться проверки форм io (правила и тексты —
capability `io-forms`): `multipart` или `upload()` в слоте `output`,
`upload()` вне `multipart`, потоковая форма без схемы-листа и без
примитива, конфликт имени файлового поля с полем `fields`. Для HTTP сюда
же SHALL входить проверка секции `sse` (capability
`http-streaming-framing`): `sse` при не-`events`-выходе и имя события
`error`, зарезервированное за mid-stream отказом.

Тип-меняющий шаг item-цепочки в слоте `output` SHALL диагностироваться
типами в точке декларации (capability `stream-item-chains`); рантайм
SHALL дублировать эту проверку для JS-потребителей.

Проверки, требующие перечня ключей схемы `input`, SHALL NOT входить в этот
набор: Standard Schema не отдаёт перечня ключей. В частности, случай
«path-параметр объявлен в шаблоне, а поля с таким именем в схеме нет» в
общем виде SHALL NOT диагностироваться при создании декларации.

Проверка соответствия форм способностям транспорта SHALL NOT входить в
этот набор: транспорт выбирается на сборке, поэтому она выполняется при
регистрации (capability `transport-form-capabilities`).

#### Scenario: Путь без ведущего слэша

- **WHEN** вызвано `httpEndpoint({ method: 'GET', path: 'users', … })`
- **THEN** вызов бросает ошибку в момент создания декларации

#### Scenario: Дублирующийся path-параметр

- **WHEN** вызвано `httpEndpoint({ method: 'GET', path: '/a/:id/b/:id', … })`
- **THEN** вызов бросает ошибку, называющую повторяющееся имя

#### Scenario: Пустое имя команды

- **WHEN** вызвано `cliEndpoint({ command: '', … })`
- **THEN** вызов бросает ошибку в момент создания декларации

#### Scenario: Нарушение правила bind-карты

- **WHEN** вызвано `httpEndpoint({ method: 'GET', path: '/users', input: ListUsers, bind: { filter: body() }, … })`
- **THEN** вызов бросает ошибку в момент создания декларации, называя
  метод и поле

#### Scenario: Повторяющийся код в errors

- **WHEN** вызвано `httpEndpoint({ …, errors: [CardDeclined, CardDeclined] })`
- **THEN** вызов бросает ошибку в момент создания декларации, называя код

#### Scenario: Нарушение правила формы io

- **WHEN** вызвано `httpEndpoint({ method: 'POST', path: '/reports', output: multipart({ files: { report: upload() } }), … })`
- **THEN** вызов бросает ошибку в момент создания декларации, называя
  слот `output` и форму `multipart`

#### Scenario: SSE-словарь без events-выхода

- **WHEN** вызвано `httpEndpoint({ …, output: Report, sse: { heartbeat: 5000 } })`
- **THEN** вызов бросает ошибку в момент создания декларации
