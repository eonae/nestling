# @nestlingjs/eslint-plugin

Три правила ESLint для кода на Nestling: граница модуля по баррель-файлу,
подсказка про слой в декларации endpoint'а и список зависимостей класса
против параметров конструктора. Правила разбирают синтаксис и файловую
структуру, поэтому рантайм `@nestlingjs/*` в зависимости не входит.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/pipeline.md`](../../docs/design/pipeline.md),
> [`docs/design/container.md`](../../docs/design/container.md).
> Гайд: [глава 6. Откуда хендлер берёт репозиторий](../../docs/guide/06-repository.md),
> [глава 10. Кто зовёт и что ему можно](../../docs/guide/10-auth.md).

## Установка

```bash
npm install --save-dev @nestlingjs/eslint-plugin
```

Файлы `*.ts` разбирает `@typescript-eslint/parser`: правила
`endpoint-has-layer` и `dependency-list` читают его дерево. Пакет
`typescript-eslint` ставится рядом.

## Минимальный пример

```javascript
// eslint.config.js
import nestling from '@nestlingjs/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestlingjs': nestling },
    rules: {
      '@nestlingjs/import-through-barrel': 'error',
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'traced', constructorName: 'httpEndpoint' },
      ],
      '@nestlingjs/dependency-list': 'warn',
    },
  },
];
```

Опция `constructorName` называет голову вызова. Правило разбирает две
формы: сам идентификатор (`cliEndpoint(…)`) и обращение к его свойству
(`httpEndpoint.get(…)`, `httpEndpoint.implement(…)`). Словарь оно берёт из
последнего аргумента, поэтому под правило попадают обе записи — и
`httpEndpoint.get('/users', { … })`, и `httpEndpoint.implement(CreateUser,
{ … })`. Декларация с `detached: '<причина>'` не подсвечивается.

Необязательный `pattern` сверяется с первым аргументом вызова, когда тот —
строковый литерал. У `httpEndpoint.implement` первый аргумент — операция,
поэтому с фильтром правило на ней молчит: адрес, непрозрачный
синтаксически, под фильтр не подвести.

## Экспорты

| Имя | Что делает |
|---|---|
| `importThroughBarrel` | правило `import-through-barrel`: импорт внутрь чужого модуля мимо его барреля. Папка без `index.ts` границей не считается, и правило про неё молчит. Проверка полная, уровень `error` |
| `endpointHasLayer` | правило `endpoint-has-layer`: декларация endpoint'а не подключает требуемый слой. Проверка неполная by design, уровень `warn` |
| `dependencyList` | правило `dependency-list`: список `@Component([…])`, `@Handler([…])` или `@Resource([…])` расходится с параметрами конструктора (у ресурса — со `static acquire` без сигнала). Ожидаемый DI-токен выводится из типа параметра: класс `X` даёт `X`, `Config<typeof X>` даёт `X`, `Port<typeof Op>` даёт `Op.caller`, `Emitter<typeof Op>` даёт `Op.emitter`, тип `X` при видимом в файле `X$` даёт `X$` (для `Logger` это `Logger$.auto`), массив `X[]` при видимом `X$` даёт `X$.all`. Остальные типы принимают написанное, а имён, которых в файле нет, правило не пишет. Расхождение длины чинит автофикс, замену элемента предлагает suggestion. Проверка неполная by design, уровень `warn` |

Плагин экспортирует и объект по умолчанию со всеми правилами — его и
подключают в `plugins`.

## Границы пакета

Правила читают исходники и не запускают приложение. Инварианты, которые
видны только на сборке контейнера, проверяет `app.build()`.
`dependency-list` различает класс и интерфейс по форме импорта: интерфейс,
импортированный значением вместо `import type`, оно считает классом.
Семейство от DI-токена оно не отличает и принимает любой DI-токен с той же
головой.
