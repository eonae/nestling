/**
 * Навигация превью — единственный источник правды.
 * Раньше сайдбар был скопирован в каждую из четырёх страниц; теперь он здесь.
 *
 * Для каждой страницы:
 *   collapsed — пункты группы, когда страница НЕ открыта (ссылки с якорями);
 *   sub       — подпункты, когда страница открыта (ссылки внутри страницы);
 *   pager     — «← Назад» / «Далее →» внизу статьи.
 *
 * Порядок массива задаёт порядок групп в сайдбаре.
 */

export const OVERVIEW_LABEL = 'Обзор';

export const PAGES = [
  {
    slug: 'index',
    group: 'Введение',
    title: 'Nestling — Введение',
    collapsed: [
      { href: 'index.html', label: 'Обзор' },
      { href: 'index.html#vs-nest', label: 'Отличия от NestJS' },
      { href: 'index.html#first-steps', label: 'Первые шаги' },
    ],
    sub: [
      { anchor: 'what', label: 'Что такое Nestling' },
      { anchor: 'philosophy', label: 'Семь принципов' },
      { anchor: 'vs-nest', label: 'Что убрали из NestJS' },
      { anchor: 'first-steps', label: 'Первые шаги' },
      { anchor: 'two-levels', label: 'Два уровня фреймворка' },
    ],
    pager: {
      next: {
        href: 'concepts.html#endpoints',
        dir: 'Далее →',
        title: 'Основные концепции',
      },
    },
  },
  {
    slug: 'concepts',
    group: 'Основные концепции',
    title: 'Nestling — Основные концепции',
    collapsed: [
      { href: 'concepts.html#endpoints', label: 'Endpoints' },
      { href: 'concepts.html#di', label: 'Провайдеры и DI' },
      { href: 'concepts.html#modules', label: 'Модули' },
      { href: 'concepts.html#result', label: 'Ok и Fail' },
      { href: 'concepts.html#pipeline', label: 'Pipeline' },
    ],
    sub: [
      { anchor: 'endpoints', label: 'Endpoints' },
      { anchor: 'di', label: 'Провайдеры и DI' },
      { anchor: 'modules', label: 'Модули' },
      { anchor: 'result', label: 'Ok и Fail' },
      { anchor: 'pipeline', label: 'Pipeline' },
    ],
    pager: {
      prev: {
        href: 'index.html#first-steps',
        dir: '← Назад',
        title: 'Введение',
      },
      next: {
        href: 'fundamentals.html#container',
        dir: 'Далее →',
        title: 'Основы',
      },
    },
  },
  {
    slug: 'fundamentals',
    group: 'Основы',
    title: 'Nestling — Основы',
    collapsed: [
      { href: 'fundamentals.html#container', label: 'Контейнер' },
      { href: 'fundamentals.html#multi', label: 'Multi-injection' },
      { href: 'fundamentals.html#lifecycle', label: 'Жизненный цикл' },
      { href: 'fundamentals.html#config', label: 'Конфигурация' },
      { href: 'fundamentals.html#context', label: 'Асинхронный контекст' },
      { href: 'fundamentals.html#streaming', label: 'Стриминг' },
      { href: 'fundamentals.html#schemas', label: 'Схемы и OpenAPI' },
      { href: 'fundamentals.html#testing', label: 'Тестирование' },
    ],
    sub: [
      { anchor: 'container', label: 'Контейнер' },
      { anchor: 'multi', label: 'Multi-injection' },
      { anchor: 'lifecycle', label: 'Жизненный цикл' },
      { anchor: 'config', label: 'Конфигурация' },
      { anchor: 'context', label: 'Асинхронный контекст' },
      { anchor: 'streaming', label: 'Стриминг' },
      { anchor: 'schemas', label: 'Схемы и OpenAPI' },
      { anchor: 'testing', label: 'Тестирование' },
    ],
    pager: {
      prev: {
        href: 'concepts.html#pipeline',
        dir: '← Назад',
        title: 'Основные концепции',
      },
      next: {
        href: 'scaling.html#monolith',
        dir: 'Далее →',
        title: 'Масштабирование',
      },
    },
  },
  {
    slug: 'scaling',
    group: 'Масштабирование',
    title: 'Nestling — Масштабирование',
    collapsed: [
      { href: 'scaling.html#monolith', label: 'Модульный монолит' },
      { href: 'scaling.html#ports', label: 'Порты и контракты' },
      { href: 'scaling.html#transports', label: 'Транспорты' },
    ],
    sub: [
      { anchor: 'monolith', label: 'Модульный монолит' },
      { anchor: 'levels', label: 'Прогрессия L0→L4' },
      { anchor: 'ports', label: 'Порты и контракты' },
      { anchor: 'transports', label: 'Транспорты' },
    ],
    pager: {
      prev: {
        href: 'fundamentals.html#streaming',
        dir: '← Назад',
        title: 'Основы',
      },
      next: { href: 'index.html', dir: 'В начало ↑', title: 'Введение' },
    },
  },
];
