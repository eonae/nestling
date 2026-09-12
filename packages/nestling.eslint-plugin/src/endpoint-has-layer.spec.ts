/**
 * `endpoint-has-layer`: что правило ловит и — важнее — где оно молчит.
 *
 * Валидных кейсов здесь больше, чем невалидных, и это соотношение
 * содержательно: правило неполно by design, поэтому каждая форма, где
 * значение непрозрачно, зафиксирована тестом как **молчание**.
 */

import { endpointHasLayer } from './endpoint-has-layer.js';

import { RuleTester } from 'eslint';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const options = [{ layer: 'authedBase', constructorName: 'httpEndpoint' }];

/** Пролог фикстур: слои объявлены локально, чтобы значение было прозрачным */
const prelude = `
  const authedBase = makePipeline();
  const observability = makePipeline();
  const handle = async () => ({});
`;

ruleTester.run('endpoint-has-layer', endpointHasLayer, {
  valid: [
    {
      name: 'слой на месте',
      code: `${prelude}
        httpEndpoint.get('/me', { pipeline: authedBase, handler: handle });`,
      options,
    },
    {
      name: 'compose со слоем',
      code: `${prelude}
        httpEndpoint.get('/me', {
          pipeline: compose(observability, authedBase),
          handler: handle,
        });`,
      options,
    },
    {
      name: 'деривация слоя',
      code: `${prelude}
        httpEndpoint.get('/me', {
          pipeline: compose(observability, authedBase.pre(withTenant())),
          handler: handle,
        });`,
      options,
    },
    {
      name: 'локальная переменная, собранная из слоя',
      code: `${prelude}
        const adminPipeline = compose(observability, authedBase);
        httpEndpoint.get('/admin', { pipeline: adminPipeline, handler: handle });`,
      options,
    },
    {
      name: 'пайплайн приезжает параметром фабрики — значение непрозрачно',
      code: `${prelude}
        export const makeUsersModule = (pipeline) =>
          httpEndpoint.get('/users', { pipeline, handler: handle });`,
      options,
    },
    {
      name: 'вызов неизвестной функции — значение непрозрачно',
      code: `${prelude}
        httpEndpoint.get('/users', { pipeline: pipelineFor('users'), handler: handle });`,
      options,
    },
    {
      name: 'импортированное значение без локального объявления',
      code: `import { basePipeline } from './pipelines.js';
        httpEndpoint.get('/users', { pipeline: basePipeline, handler: handle });`,
      options,
    },
    {
      name: 'spread в словаре — декларация непрозрачна',
      code: `${prelude}
        httpEndpoint.get('/users', { ...common, handler: handle });`,
      options,
    },
    {
      name: 'detached глушит правило',
      code: `${prelude}
        httpEndpoint.get('/health', {
          detached: 'liveness-проба балансировщика',
          handler: handle,
        });`,
      options,
    },
    {
      name: 'ручка вне фильтра пути',
      code: `${prelude}
        httpEndpoint.get('/health', { pipeline: observability, handler: handle });`,
      options: [{ layer: 'authedBase', pattern: '^/admin' }],
    },
    {
      name: 'чужой конструктор',
      code: `${prelude}
        cliEndpoint('import', { pipeline: observability, handler: handle });`,
      options,
    },
    {
      name: 'фильтр по пути при форме с операцией — адрес не литерал',
      code: `${prelude}
        httpEndpoint.implement(CreateUser, { pipeline: observability, handler: handle });`,
      options: [{ layer: 'authedBase', pattern: '^/admin' }],
    },
  ],

  invalid: [
    {
      // Заодно предмет проверки — текст: сообщение обязано называть свой
      // статус подсказки и указывать, где живёт гарантия
      name: 'другой слой',
      code: `${prelude}
        httpEndpoint.get('/users', { pipeline: observability, handler: handle });`,
      options,
      errors: [
        {
          message:
            "Endpoint declaration does not appear to compose layer 'authedBase'. " +
            'This is an editor hint, not a guarantee: the guarantee is the ' +
            'assembly policy check (everyEndpoint({ … }).hasLayer(authedBase)) in ' +
            "the composition root. Opt out deliberately with detached: '<reason>'.",
        },
      ],
    },
    {
      name: 'compose без нужного слоя',
      code: `${prelude}
        const logging = makePipeline();
        httpEndpoint.get('/users', {
          pipeline: compose(observability, logging),
          handler: handle,
        });`,
      options,
      errors: [{ messageId: 'missingLayer' }],
    },
    {
      name: 'pipeline отсутствует вовсе',
      code: `${prelude}
        httpEndpoint.get('/users', { handler: handle });`,
      options,
      errors: [{ messageId: 'missingLayer' }],
    },
    {
      // Форма с операцией попала под правило впервые: раньше callee был
      // обращением к свойству, и правило её не разбирало
      name: 'реализация операции без слоя',
      code: `${prelude}
        httpEndpoint.implement(CreateUser, { handler: handle });`,
      options,
      errors: [{ messageId: 'missingLayer' }],
    },
    {
      name: 'команда CLI без слоя',
      code: `${prelude}
        cliEndpoint('users:list', { pipeline: observability, handler: handle });`,
      options: [{ layer: 'authedBase', constructorName: 'cliEndpoint' }],
      errors: [{ messageId: 'missingLayer' }],
    },
    {
      name: 'ручка под фильтром пути',
      code: `${prelude}
        httpEndpoint.get('/admin/users', { pipeline: observability, handler: handle });`,
      options: [{ layer: 'authedBase', pattern: '^/admin' }],
      errors: [{ messageId: 'missingLayer' }],
    },
  ],
});
