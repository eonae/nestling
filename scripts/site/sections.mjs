/**
 * Источники собранного сайта и их порядок.
 *
 * Источник трёх видов. `folder` — папка с оглавлением `README.md`: её README
 * открывает разделы источника, каждый файл папки становится своим разделом.
 * `page` — отдельный файл: он даёт один раздел. `packages` — каталоги
 * `packages/`: состав и порядок берутся из раздела «Пакеты» файла
 * `docs/README.md`, раздел собирается из README каталога. Ещё один вид,
 * `home`, занимает стартовую страницу и встречается один раз.
 *
 * Порядок записей задаёт порядок разделов в `nestling-docs.html` и порядок
 * пунктов сайдбара.
 *
 * Поле `section` — первый сегмент адреса раздела: у главы гайда адрес
 * `/guide/01-first-service/`. У страницы секции нет, и адрес короче на
 * сегмент: `/glossary/`.
 *
 * Поле `group` называет группу сайдбара: у папки с заголовками
 * `## Часть N. …` и у пакетов группы дают эти заголовки, а `group`
 * остаётся за оглавлением источника; у папки без них и у страницы группа
 * одна и названа здесь.
 *
 * Поле `badge` необязательное: страница источника показывает его в шапке.
 *
 * Заголовок раздела берётся из заголовка первого уровня самого файла.
 */
export const SECTIONS = [
  { kind: 'home', path: 'docs/index.md' },
  { kind: 'folder', path: 'docs/guide', section: 'guide', group: 'Гайд' },
  { kind: 'folder', path: 'docs/recipes', section: 'recipes', group: 'Рецепты' },
  {
    kind: 'packages',
    path: 'packages',
    section: 'reference',
    group: 'Справочник пакетов',
  },
  {
    kind: 'folder',
    path: 'docs/design',
    section: 'design',
    group: 'Целевое состояние',
    badge: 'целевое состояние V1',
  },
  { kind: 'page', path: 'docs/guarantees.md', group: 'Справочники' },
  { kind: 'page', path: 'docs/from-nestjs.md', group: 'Справочники' },
  { kind: 'page', path: 'docs/glossary.md', group: 'Справочники' },
  { kind: 'page', path: 'docs/conventions.md', group: 'Справочники' },
  { kind: 'page', path: 'docs/decisions/roadmap.md', group: 'Планы' },
  { kind: 'page', path: 'docs/decisions/deferred.md', group: 'Планы' },
];

/** Оглавление источника-пакетов: раздел «Пакеты» этого файла */
export const PACKAGES_OUTLINE = 'docs/README.md';

/** Быстрые ссылки в шапке: идентификатор раздела и подпись */
export const TOP_LINKS = [
  { id: 'guide--01-first-service', label: 'Сервис' },
  { id: 'guide--14-features', label: 'Приложение' },
  { id: 'recipes', label: 'Рецепты' },
];
