# @nestling/eslint-plugin

Два правила ESLint для кода на Nestling: граница модуля по баррель-файлу и
подсказка про слой в декларации endpoint'а. Правила разбирают синтаксис и
файловую структуру, поэтому рантайм `@nestling/*` в зависимости не входит.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/pipeline.md`](../../docs/design/pipeline.md).
> Гайд: [глава 10. Кто зовёт и что ему можно](../../docs/guide/10-auth.md).

## Установка

```bash
npm install --save-dev @nestling/eslint-plugin
```

## Минимальный пример

```javascript
// eslint.config.js
import nestling from '@nestling/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestling': nestling },
    rules: {
      '@nestling/import-through-barrel': 'error',
      '@nestling/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
```

## Экспорты

| Имя | Что делает |
|---|---|
| `importThroughBarrel` | правило `import-through-barrel`: импорт внутрь чужого модуля мимо его барреля. Папка без `index.ts` границей не считается, и правило про неё молчит. Проверка полная, уровень `error` |
| `endpointHasLayer` | правило `endpoint-has-layer`: декларация endpoint'а не подключает требуемый слой. Проверка неполная by design, уровень `warn` |

Плагин экспортирует и объект по умолчанию с обоими правилами — его и
подключают в `plugins`.

## Границы пакета

Правила читают исходники и не запускают приложение. Инварианты, которые
видны только на сборке контейнера, проверяет `app.assemble()`.
