import { createEslintConfig } from '../../.config/eslint.config.js';

/**
 * Направление зависимостей между слоями пакета.
 *
 * Слои лежат каталогами `src`, и каждый входит через свой баррель, поэтому
 * специфаер импорта — достаточный признак: `../pipeline/index.js` виден в
 * тексте файла. Список — это порядок слоёв: конфиг читается до запроса,
 * пайплайн ничего не знает о транспорте, транспорт — о портах, порты — о
 * композиционном корне. Логгер стоит над конфигом и контекстом запроса:
 * его реализация читает секцию и `Ctx(RequestId)`, а пайплайн берёт у
 * него только интерфейс и умолчание для standalone-путей.
 *
 * Правило живёт в конфиге пакета, а не в общем: раскладка слоёв есть
 * свойство этого пакета.
 */
const zones = [
  { zone: 'pipeline', forbidden: ['config', 'transport', 'ports', 'root'] },
  { zone: 'config', forbidden: ['pipeline', 'transport', 'ports', 'root'] },
  { zone: 'logger', forbidden: ['transport', 'ports', 'root'] },
  { zone: 'transport', forbidden: ['config', 'ports', 'root'] },
  { zone: 'ports', forbidden: ['root'] },
];

export default [
  ...createEslintConfig(import.meta.url),
  ...zones.map(({ zone, forbidden }) => ({
    files: [`src/${zone}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((target) => ({
            group: [`**/${target}/*`, `**/${target}/**/*`],
            message:
              `Слой '${zone}' не импортирует слой '${target}': стрелка ` +
              `зависимостей идёт в обратную сторону. Перенеси нужное вниз ` +
              `или опиши структурно, как это делает 'ports/topology.ts'.`,
          })),
        },
      ],
    },
  })),
];
