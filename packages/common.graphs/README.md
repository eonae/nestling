# @common/graphs

Направленный ациклический граф: добавление узлов, обход в топологическом и
обратном топологическом порядке, обнаружение циклов. Им пользуется
`@nestling/container` для графа зависимостей и порядка жизненного цикла.

> Внутренний пакет Nestling: ставится вместе с ядром, отдельно не публикуется.

## Установка

Пакет внутренний и приходит зависимостью `@nestling/container`. Отдельно
устанавливать его не нужно.

## Минимальный пример

```typescript
import { DAG } from '@common/graphs';

interface Service {
  id: string;
  dependencies: readonly Service[];
}

const db: Service = { id: 'db', dependencies: [] };
const repo: Service = { id: 'repo', dependencies: [db] };

const graph = new DAG<Service>();
graph.addNode(db);
graph.addNode(repo);

// Сначала `db`, затем `repo`: зависимость идёт раньше зависимого.
await graph.traverse((node) => console.log(node.id), {
  direction: 'topological',
});
```

## Экспорты

| Имя | Что делает |
|---|---|
| `DAG` | граф узлов: добавление, поиск по `id`, обход, обнаружение циклов |
| `INode` | интерфейс узла: `id` и список зависимостей |
| `TraversalDirection` | направление обхода: топологическое или обратное |
| `VisitOptions` | параметры обхода: фильтр узлов и направление |
| `VisitCallback` | колбэк обхода; может вернуть промис |

## Границы пакета

Граф хранит узлы и порядок между ними. Создание экземпляров, разрешение
зависимостей и хуки жизненного цикла живут в `@nestling/container`.
