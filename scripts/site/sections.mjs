/**
 * Источники собранного сайта, их порядок и языки.
 *
 * Источник трёх видов. `folder` — папка с оглавлением `README.md`: её README
 * открывает разделы источника, каждый файл папки становится своим разделом.
 * `page` — отдельный файл: он даёт один раздел. `packages` — каталоги
 * `packages/`: состав и порядок берутся из раздела «Пакеты» файла
 * `docs/README.md`, раздел собирается из README каталога. Ещё один вид,
 * `home`, занимает стартовую страницу и встречается один раз.
 *
 * Порядок записей задаёт порядок разделов в `nestling-docs.html` и порядок
 * пунктов сайдбара. Он общий для языков: различается только текст.
 *
 * Поле `section` — первый сегмент адреса раздела после префикса языка: у
 * главы гайда адрес `/guide/01-first-service/`. У страницы секции нет, и
 * адрес короче на сегмент: `/glossary/`.
 *
 * Поле `group` называет группу сайдбара на каждом языке: у папки с
 * заголовками `## Часть N. …` и у пакетов группы дают эти заголовки, а
 * `group` остаётся за оглавлением источника; у папки без них и у страницы
 * группа одна и названа здесь.
 *
 * Поле `badge` необязательное: страница источника показывает его в шапке.
 *
 * Путь источника записан по русскому оригиналу. Путь файла языка даёт
 * `sourcePath`.
 *
 * Заголовок раздела берётся из заголовка первого уровня самого файла.
 */

/**
 * Языки сайта: код, префикс адреса и подпись переключателя.
 *
 * Английский идёт первым и без префикса: сайт читает тот, кто нашёл пакет
 * в реестре. Русский лежит в подпути `/ru/`.
 */
export const LANGUAGES = [
  { code: 'en', prefix: [], label: 'English', default: true },
  { code: 'ru', prefix: ['ru'], label: 'Русский' },
];

/** Язык по умолчанию: его дерево лежит в корне вывода */
export const DEFAULT_LANGUAGE = LANGUAGES.find((lang) => lang.default).code;

/**
 * Путь файла на языке: английская документация лежит зеркалом в `docs/en/`.
 *
 * Русский файл остаётся на месте, поэтому ссылки на него из кода, скиллов
 * и `openspec/` не переезжают.
 */
export function sourcePath(path, lang) {
  return lang === 'en' && path.startsWith('docs/')
    ? `docs/en/${path.slice('docs/'.length)}`
    : path;
}

/**
 * Имя README пакета на языке.
 *
 * Английский текст — основной файл: его показывает страница пакета в
 * реестре, и подменить его там нечем.
 */
export const readmeName = (lang) => (lang === 'en' ? 'README.md' : 'README.ru.md');

export const SECTIONS = [
  { kind: 'home', path: 'docs/index.md' },
  {
    kind: 'folder',
    path: 'docs/guide',
    section: 'guide',
    group: { en: 'Guide', ru: 'Гайд' },
  },
  {
    kind: 'folder',
    path: 'docs/recipes',
    section: 'recipes',
    group: { en: 'Recipes', ru: 'Рецепты' },
  },
  {
    kind: 'packages',
    path: 'packages',
    section: 'reference',
    group: { en: 'Package reference', ru: 'Справочник пакетов' },
  },
  {
    kind: 'folder',
    path: 'docs/design',
    section: 'design',
    group: { en: 'Target state', ru: 'Целевое состояние' },
    badge: { en: 'target state of V1', ru: 'целевое состояние V1' },
  },
  {
    kind: 'page',
    path: 'docs/guarantees.md',
    group: { en: 'References', ru: 'Справочники' },
  },
  {
    kind: 'page',
    path: 'docs/from-nestjs.md',
    group: { en: 'References', ru: 'Справочники' },
  },
  {
    kind: 'page',
    path: 'docs/glossary.md',
    group: { en: 'References', ru: 'Справочники' },
  },
  {
    kind: 'page',
    path: 'docs/conventions.md',
    group: { en: 'References', ru: 'Справочники' },
  },
];

/** Оглавление источника-пакетов: раздел «Пакеты» этого файла */
export const PACKAGES_OUTLINE = 'docs/README.md';

/**
 * Группы справочника пакетов по-английски.
 *
 * Оглавление пакетов лежит в `docs/README.md` — файле о ведении
 * репозитория, который не публикуется и пары не имеет. Поэтому его
 * заголовки `###` переводятся здесь; заголовок без перевода останавливает
 * сборку.
 */
export const PACKAGE_GROUPS = {
  'Для автора приложения': 'For the application author',
  'Транспорты и шина': 'Transports and bus',
  'Инструменты и сателлиты': 'Tools and satellites',
  Внутренние: 'Internal',
};

/** Быстрые ссылки в шапке: идентификатор раздела и подпись на каждом языке */
export const TOP_LINKS = [
  { id: 'guide--01-first-service', label: { en: 'Service', ru: 'Сервис' } },
  { id: 'guide--14-features', label: { en: 'Application', ru: 'Приложение' } },
  { id: 'recipes', label: { en: 'Recipes', ru: 'Рецепты' } },
];

/**
 * Подписи оформления на каждом языке.
 *
 * Страница английского дерева не показывает русских слов ни в шапке, ни в
 * пейджере, ни в поиске.
 */
export const UI = {
  en: {
    tagline: 'docs',
    menu: 'Menu',
    theme: 'Theme',
    language: 'Language',
    search: 'Search the documentation',
    prev: '← Back',
    next: 'Next →',
    empty: 'Nothing found for',
    siteTitle: 'Nestling — documentation',
    notFoundTitle: 'Page not found',
    notFoundHead: 'No such page',
    notFoundText:
      'The address of a section may have changed: the documentation is built ' +
      'again on every change of its source files.',
    notFoundLink: 'To the start of the documentation',
  },
  ru: {
    tagline: 'документация',
    menu: 'Меню',
    theme: 'Тема',
    language: 'Язык',
    search: 'Поиск по документации',
    prev: '← Назад',
    next: 'Далее →',
    empty: 'Ничего не нашлось по',
    siteTitle: 'Nestling — документация',
    notFoundTitle: 'Страница не найдена',
    notFoundHead: 'Такой страницы нет',
    notFoundText:
      'Адрес раздела мог измениться: документация собирается заново на каждое ' +
      'изменение исходных файлов.',
    notFoundLink: 'К началу документации',
  },
};
