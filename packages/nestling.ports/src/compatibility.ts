/**
 * Дифф контрактов против снапшота — чистая функция двух значений.
 *
 * «Подсвечивает, но не блокирует» здесь — свойство конструкции, а не
 * обещание в доке: `diffContracts` не участвует в сборке, не вызывается
 * из `run()`/`check()` и ничего не бросает по результату сравнения,
 * сколько бы `breaking` в нём ни было. Флага «падать на breaking» не
 * существует; превратить отчёт в падающий тест — код пользователя.
 *
 * Единственное исключение — нечитаемый baseline: это ошибка автора
 * проверки, а не breaking change, и она бросает.
 *
 * Словарь вердиктов закрыт тремя значениями, а правила опубликованы. Всё,
 * что в них не попало — незнакомые ключевые слова JSON Schema,
 * непрозрачные листья, смена вендора, — даёт `unknown`, а не молчаливое
 * «совместимо»: молчание на непонятом узле есть ровно тот режим, ради
 * выхода из которого затевается дифф.
 */

import type {
  FileFieldDescriptor,
  FormDescriptorValue,
  JsonValue,
  SchemaDescriptor,
} from './describe.js';
import type { ContractSnapshot, SnapshotContract } from './snapshot.js';
import { SNAPSHOT_VERSION } from './snapshot.js';

/** Слот формы: он же направление сравнения */
export type ContractSlot = 'input' | 'output';

/** Закрытый словарь вердиктов */
export type CompatibilityVerdict = 'breaking' | 'additive' | 'unknown';

/** Одно расхождение между снапшотами */
export interface CompatibilityChange {
  /** Имя контракта, в котором найдено расхождение */
  readonly contract: string;

  /** Путь до узла: `output.chargeId`, `errors.CARD_DECLINED`, `kind` */
  readonly path: string;

  /** Человекочитаемое описание расхождения */
  readonly description: string;

  readonly verdict: CompatibilityVerdict;
}

/** Итог по одному контракту */
export interface ContractCompatibility {
  readonly contract: string;

  /** Число расхождений каждого вида */
  readonly breaking: number;
  readonly additive: number;
  readonly unknown: number;

  /**
   * **Подсказка** нового имени — только у контракта с хотя бы одним
   * `breaking`. Ровно подсказка: переименования не происходит, суффикса
   * ядро не требует и нигде больше не разбирает.
   */
  readonly suggestedName?: string;
}

/** Отчёт совместимости: значение, а не лог */
export interface CompatibilityReport {
  readonly breaking: readonly CompatibilityChange[];
  readonly additive: readonly CompatibilityChange[];
  readonly unknown: readonly CompatibilityChange[];

  /** Итоги по контрактам, у которых нашлось хотя бы одно расхождение */
  readonly contracts: readonly ContractCompatibility[];
}

// ---------------------------------------------------------------------------
// Разбираемое подмножество JSON Schema
// ---------------------------------------------------------------------------

/**
 * Ключевые слова, о которых дифф умеет рассуждать.
 *
 * Подмножество закрыто намеренно: полноценный сабтайпинг JSON Schema в
 * ядро не тянем. Рекурсия идёт по `properties` и `items`.
 */
const PARSED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'nullable',
]);

/**
 * Композиционные ключевые слова: их присутствие делает узел
 * неразбираемым целиком.
 *
 * Любое расхождение в таком узле или под ним — `unknown` с путём:
 * сравнивать `properties` под `allOf` значило бы врать о семантике.
 */
const COMPOSITION_KEYWORDS = new Set([
  '$ref',
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'if',
  'then',
  'else',
  'const',
  'patternProperties',
  'prefixItems',
  'additionalItems',
  'dependentSchemas',
]);

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Равенство значений по канонической сериализации (схемы канонизированы) */
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const hasComposition = (node: unknown): boolean =>
  isRecord(node) &&
  Object.keys(node).some((key) => COMPOSITION_KEYWORDS.has(key));

/** Множество типов узла: `type` бывает и строкой, и массивом */
function typeSet(node: Record<string, JsonValue>): Set<string> | undefined {
  const type = node.type;

  if (typeof type === 'string') {
    return new Set([type]);
  }
  if (Array.isArray(type)) {
    return new Set(type.map(String));
  }

  return undefined;
}

/** Каждый элемент `subset` есть в `superset` */
const covers = (superset: Set<string>, subset: Set<string>): boolean =>
  [...subset].every((item) => superset.has(item));

// ---------------------------------------------------------------------------
// Накопитель расхождений
// ---------------------------------------------------------------------------

class Changes {
  readonly #items: CompatibilityChange[] = [];

  add(
    contract: string,
    path: string,
    verdict: CompatibilityVerdict,
    description: string,
  ): void {
    this.#items.push({ contract, path, description, verdict });
  }

  of(verdict: CompatibilityVerdict): CompatibilityChange[] {
    return this.#items.filter((change) => change.verdict === verdict);
  }

  contracts(): ContractCompatibility[] {
    const byName = new Map<string, Record<CompatibilityVerdict, number>>();

    for (const change of this.#items) {
      const counts = byName.get(change.contract) ?? {
        breaking: 0,
        additive: 0,
        unknown: 0,
      };
      counts[change.verdict] += 1;
      byName.set(change.contract, counts);
    }

    return [...byName.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([contract, counts]) => ({
        contract,
        ...counts,
        // Подсказка появляется ровно там, где есть что ломать
        ...(counts.breaking > 0
          ? { suggestedName: suggestBump(contract) }
          : {}),
      }));
  }
}

/**
 * Следующее имя версии: `<name>` → `<name>.v2`, `<name>.vN` → `.v{N+1}`.
 *
 * **Единственное** место, где суффикс `.vN` распознаётся: `makeContract`
 * его не требует и не разбирает, отдельного поля версии не существует, и
 * контракт без суффикса легален.
 */
export function suggestBump(name: string): string {
  const match = /^(?<base>.*)\.v(?<version>\d+)$/.exec(name);

  if (!match?.groups) {
    return `${name}.v2`;
  }

  return `${match.groups.base}.v${Number(match.groups.version) + 1}`;
}

// ---------------------------------------------------------------------------
// Дифф JSON Schema
// ---------------------------------------------------------------------------

interface DiffContext {
  readonly contract: string;
  readonly slot: ContractSlot;
  readonly changes: Changes;
}

/**
 * Вердикт для изменения множества принимаемых/отдаваемых значений.
 *
 * Направление берётся из **слота**, а не из роли смотрящего: `input`
 * приходит в реализацию (сужение принимаемого — `breaking`), `output`
 * уходит из неё (ослабление гарантии — `breaking`). Правило одинаково для
 * всех трёх видов контрактов, включая `event`, где реализация является
 * подписчиком.
 */
function verdictOfType(
  slot: ContractSlot,
  base: Set<string>,
  current: Set<string>,
): CompatibilityVerdict {
  if (slot === 'input') {
    // Принимаемое множество не должно уменьшаться
    return covers(current, base) ? 'additive' : 'breaking';
  }

  // Гарантия на выход не должна ослабевать
  return covers(base, current) ? 'additive' : 'breaking';
}

/** Разбирает пару узлов JSON Schema, дописывая расхождения в накопитель */
function diffNode(
  context: DiffContext,
  path: string,
  base: JsonValue | undefined,
  current: JsonValue | undefined,
): void {
  if (same(base, current)) {
    return;
  }

  const { contract, changes } = context;

  if (!isRecord(base) || !isRecord(current)) {
    changes.add(
      contract,
      path,
      'unknown',
      `schema node is not a JSON Schema object on both sides`,
    );
    return;
  }

  if (hasComposition(base) || hasComposition(current)) {
    changes.add(
      contract,
      path,
      'unknown',
      `schema node uses a keyword outside the parsed subset ` +
        `(${[...COMPOSITION_KEYWORDS].filter((keyword) => keyword in base || keyword in current).join(', ')})`,
    );
    return;
  }

  // Незнакомые ключевые слова: расхождение в них — `unknown`, совпадение
  // расхождением не является (иначе `$schema` красил бы весь отчёт)
  for (const keyword of [
    ...new Set([...Object.keys(base), ...Object.keys(current)]),
  ].sort()) {
    if (PARSED_KEYWORDS.has(keyword)) {
      continue;
    }
    if (!same(base[keyword], current[keyword])) {
      changes.add(
        contract,
        path,
        'unknown',
        `keyword '${keyword}' changed and is outside the parsed subset`,
      );
    }
  }

  if (!same(base.nullable, current.nullable)) {
    changes.add(
      contract,
      path,
      'unknown',
      `'nullable' changed: ${String(base.nullable)} → ${String(current.nullable)}`,
    );
  }

  diffType(context, path, base, current);
  diffEnum(context, path, base, current);
  diffProperties(context, path, base, current);

  if ('items' in base || 'items' in current) {
    diffNode(context, `${path}[]`, base.items, current.items);
  }
}

function diffType(
  context: DiffContext,
  path: string,
  base: Record<string, JsonValue>,
  current: Record<string, JsonValue>,
): void {
  if (same(base.type, current.type)) {
    return;
  }

  const baseTypes = typeSet(base);
  const currentTypes = typeSet(current);

  if (!baseTypes || !currentTypes) {
    context.changes.add(
      context.contract,
      path,
      'unknown',
      `'type' appeared or disappeared: ${JSON.stringify(base.type)} → ` +
        `${JSON.stringify(current.type)}`,
    );
    return;
  }

  context.changes.add(
    context.contract,
    path,
    verdictOfType(context.slot, baseTypes, currentTypes),
    `'type' changed: ${[...baseTypes].sort().join(' | ')} → ` +
      `${[...currentTypes].sort().join(' | ')}`,
  );
}

/**
 * Дифф `enum` — по опубликованной таблице, одинаково в обоих слотах.
 *
 * Удаление значения breaking и во входе, и в выходе: во входе оно сужает
 * принимаемое, в выходе — убирает опубликованное состояние, на которое
 * потребитель уже ветвится (та же конвенция, что у GraphQL и protobuf).
 */
function diffEnum(
  context: DiffContext,
  path: string,
  base: Record<string, JsonValue>,
  current: Record<string, JsonValue>,
): void {
  const baseValues = base.enum;
  const currentValues = current.enum;

  if (same(baseValues, currentValues)) {
    return;
  }

  if (!Array.isArray(baseValues) || !Array.isArray(currentValues)) {
    context.changes.add(
      context.contract,
      path,
      'unknown',
      `'enum' appeared or disappeared`,
    );
    return;
  }

  const key = (value: JsonValue): string => JSON.stringify(value);
  const baseKeys = new Set(baseValues.map((value) => key(value)));
  const currentKeys = new Set(currentValues.map((value) => key(value)));

  for (const value of baseValues) {
    if (!currentKeys.has(key(value))) {
      context.changes.add(
        context.contract,
        path,
        'breaking',
        `enum value ${key(value)} removed`,
      );
    }
  }

  for (const value of currentValues) {
    if (!baseKeys.has(key(value))) {
      context.changes.add(
        context.contract,
        path,
        'additive',
        `enum value ${key(value)} added`,
      );
    }
  }
}

const requiredNames = (node: Record<string, JsonValue>): Set<string> =>
  new Set(Array.isArray(node.required) ? node.required.map(String) : []);

function diffProperties(
  context: DiffContext,
  path: string,
  base: Record<string, JsonValue>,
  current: Record<string, JsonValue>,
): void {
  const baseProperties = isRecord(base.properties)
    ? base.properties
    : undefined;
  const currentProperties = isRecord(current.properties)
    ? current.properties
    : undefined;

  if (!baseProperties && !currentProperties) {
    return;
  }

  const { contract, slot, changes } = context;
  const baseRequired = requiredNames(base);
  const currentRequired = requiredNames(current);

  const names = [
    ...new Set([
      ...Object.keys(baseProperties ?? {}),
      ...Object.keys(currentProperties ?? {}),
    ]),
  ].sort();

  for (const name of names) {
    const nested = `${path}.${name}`;
    const inBase = Boolean(baseProperties && name in baseProperties);
    const inCurrent = Boolean(currentProperties && name in currentProperties);

    if (inBase && !inCurrent) {
      // Во входе строгий приём отвергает поле, которое раньше принимал;
      // в выходе исчезает обещанное значение — breaking в обоих слотах
      changes.add(contract, nested, 'breaking', 'property removed');
      continue;
    }

    if (!inBase && inCurrent) {
      const required = currentRequired.has(name);
      const verdict: CompatibilityVerdict =
        slot === 'input' && required ? 'breaking' : 'additive';

      changes.add(
        contract,
        nested,
        verdict,
        `property added (${required ? 'required' : 'optional'})`,
      );
      continue;
    }

    const wasRequired = baseRequired.has(name);
    const isRequired = currentRequired.has(name);

    if (wasRequired !== isRequired) {
      const tightened = !wasRequired && isRequired;
      const verdict: CompatibilityVerdict =
        slot === 'input'
          ? tightened
            ? 'breaking'
            : 'additive'
          : tightened
            ? 'additive'
            : 'breaking';

      changes.add(
        contract,
        nested,
        verdict,
        tightened ? 'optional became required' : 'required became optional',
      );
    }

    diffNode(
      context,
      nested,
      baseProperties?.[name],
      currentProperties?.[name],
    );
  }
}

// ---------------------------------------------------------------------------
// Дифф форм и контрактов
// ---------------------------------------------------------------------------

const describeLeafKind = (leaf: SchemaDescriptor): string => {
  switch (leaf.leaf) {
    case 'primitive': {
      return `primitive '${leaf.primitive}'`;
    }
    case 'schema': {
      return `schema (${leaf.vendor})`;
    }
    case 'opaque': {
      return `opaque schema (${leaf.vendor})`;
    }
    default: {
      return 'no leaf';
    }
  }
};

function diffLeaf(
  context: DiffContext,
  path: string,
  base: SchemaDescriptor,
  current: SchemaDescriptor,
): void {
  const { contract, changes } = context;

  if (base.leaf === 'none' && current.leaf === 'none') {
    return;
  }

  if (base.leaf === 'schema' && current.leaf === 'schema') {
    if (base.vendor !== current.vendor) {
      changes.add(
        contract,
        path,
        'unknown',
        `schema vendor changed: ${base.vendor} → ${current.vendor}`,
      );
      return;
    }

    diffNode(context, path, base.jsonSchema, current.jsonSchema);
    return;
  }

  // Непрозрачность хотя бы с одной стороны: сравнивать нечего, и делать
  // вид, что «изменений нет», — ровно та молчаливая совместимость, от
  // которой дифф и уводит
  if (base.leaf === 'opaque' || current.leaf === 'opaque') {
    if (base.leaf === 'none' || current.leaf === 'none') {
      changes.add(
        contract,
        path,
        'breaking',
        `leaf changed: ${describeLeafKind(base)} → ${describeLeafKind(current)}`,
      );
      return;
    }

    const bothOpaque =
      base.leaf === 'opaque' &&
      current.leaf === 'opaque' &&
      base.vendor === current.vendor;

    changes.add(
      contract,
      path,
      'unknown',
      bothOpaque
        ? `leaf is opaque on both sides (${(base as { vendor: string }).vendor}): ` +
            `connect a schema converter to compare it`
        : `leaf is opaque on at least one side: ` +
            `${describeLeafKind(base)} → ${describeLeafKind(current)}`,
    );
    return;
  }

  if (base.leaf === 'primitive' && current.leaf === 'primitive') {
    if (base.primitive !== current.primitive) {
      changes.add(
        contract,
        path,
        'breaking',
        `primitive leaf changed: ${base.primitive} → ${current.primitive}`,
      );
    }
    return;
  }

  changes.add(
    contract,
    path,
    'breaking',
    `leaf changed: ${describeLeafKind(base)} → ${describeLeafKind(current)}`,
  );
}

function diffFiles(
  context: DiffContext,
  path: string,
  base: Readonly<Record<string, FileFieldDescriptor>> | undefined,
  current: Readonly<Record<string, FileFieldDescriptor>> | undefined,
): void {
  if (same(base, current)) {
    return;
  }

  const names = [
    ...new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {})]),
  ].sort();

  for (const name of names) {
    if (same(base?.[name], current?.[name])) {
      continue;
    }

    // Файловые поля правила не покрывают: лимиты и MIME — свойства
    // транспорта, а не схемы, и приравнивать их к схемному сужению
    // значило бы придумать правило вместо того, чтобы его опубликовать
    context.changes.add(
      context.contract,
      `${path}.files.${name}`,
      'unknown',
      `multipart file field changed`,
    );
  }
}

function diffForm(
  contract: string,
  slot: ContractSlot,
  base: FormDescriptorValue,
  current: FormDescriptorValue,
  changes: Changes,
): void {
  if (base.kind !== current.kind) {
    changes.add(
      contract,
      slot,
      'breaking',
      `io form changed: ${base.kind} → ${current.kind}`,
    );
    return;
  }

  const context: DiffContext = { contract, slot, changes };

  diffLeaf(context, slot, base.leaf, current.leaf);

  if (base.kind !== 'multipart') {
    return;
  }

  diffLeaf(
    context,
    `${slot}.fields`,
    base.fields ?? { leaf: 'none' },
    current.fields ?? { leaf: 'none' },
  );
  diffFiles(context, slot, base.files, current.files);
}

function diffErrors(
  contract: string,
  base: SnapshotContract,
  current: SnapshotContract,
  changes: Changes,
): void {
  const baseByCode = new Map(base.errors.map((fail) => [fail.code, fail]));
  const currentByCode = new Map(
    current.errors.map((fail) => [fail.code, fail]),
  );

  const codes = [
    ...new Set([...baseByCode.keys(), ...currentByCode.keys()]),
  ].sort();

  for (const code of codes) {
    const was = baseByCode.get(code);
    const is = currentByCode.get(code);
    const path = `errors.${code}`;

    if (was && !is) {
      // Снапшот фиксирует опубликованные обещания: исчезнувший код ломает
      // исчерпывающий разбор `E` у потребителя
      changes.add(contract, path, 'breaking', 'declared failure removed');
      continue;
    }

    if (!was && is) {
      // Незадекларированный код доезжает `UnknownError`'ом — это
      // предусмотрено моделью ошибок
      changes.add(contract, path, 'additive', 'declared failure added');
      continue;
    }

    if (was && is && was.status !== is.status) {
      changes.add(
        contract,
        path,
        'breaking',
        `failure status changed: ${was.status} → ${is.status}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Публичная поверхность
// ---------------------------------------------------------------------------

/**
 * Fail-fast нечитаемого снапшота.
 *
 * Отделено от результата сравнения намеренно: «я не умею читать этот
 * файл» и «контракт сломан» — разные события, и смешивать их значило бы
 * прятать ошибку автора проверки за отчётом.
 */
function assertReadable(snapshot: unknown, side: string): ContractSnapshot {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new TypeError(
      `diffContracts(...): the ${side} snapshot must be a value of shape ` +
        `{ snapshotVersion: ${SNAPSHOT_VERSION}, contracts: [...] }, got ` +
        `${snapshot === null ? 'null' : typeof snapshot}.`,
    );
  }

  const { snapshotVersion, contracts } = snapshot as ContractSnapshot;

  if (snapshotVersion !== SNAPSHOT_VERSION) {
    throw new Error(
      `diffContracts(...): the ${side} snapshot has format version ` +
        `${JSON.stringify(snapshotVersion)}, but this version reads ` +
        `${SNAPSHOT_VERSION}. Rebuild the snapshot with the version of ` +
        `nestling that will read it.`,
    );
  }

  if (!Array.isArray(contracts)) {
    throw new TypeError(
      `diffContracts(...): the ${side} snapshot has no 'contracts' array.`,
    );
  }

  return snapshot as ContractSnapshot;
}

/**
 * Сравнивает текущий состав контрактов с опубликованным снапшотом.
 *
 * @param baseline - Снапшот опубликованных контрактов
 * @param current - Снапшот текущей сборки
 * @returns Отчёт-значение: расхождения, сгруппированные по вердикту
 * @throws {TypeError | Error} Только на нечитаемом снапшоте (неизвестная
 * `snapshotVersion`, значение не того вида) — по результату сравнения
 * **никогда**
 *
 * @example
 * ```typescript
 * const report = diffContracts(baseline, snapshotContracts(reports));
 * console.log(formatCompatibility(report));
 * ```
 */
export function diffContracts(
  baseline: ContractSnapshot,
  current: ContractSnapshot,
): CompatibilityReport {
  const before = assertReadable(baseline, 'baseline');
  const after = assertReadable(current, 'current');

  const changes = new Changes();

  const baseByName = new Map(
    before.contracts.map((contract) => [contract.name, contract]),
  );
  const currentByName = new Map(
    after.contracts.map((contract) => [contract.name, contract]),
  );

  const names = [
    ...new Set([...baseByName.keys(), ...currentByName.keys()]),
  ].sort();

  for (const name of names) {
    const was = baseByName.get(name);
    const is = currentByName.get(name);

    if (was && !is) {
      changes.add(name, '', 'breaking', 'contract disappeared');
      continue;
    }

    if (!was && is) {
      changes.add(name, '', 'additive', 'contract appeared');
      continue;
    }

    /* c8 ignore next 3 -- обе ветки выше исчерпывают отсутствие стороны */
    if (!was || !is) {
      continue;
    }

    if (was.kind !== is.kind) {
      changes.add(
        name,
        'kind',
        'breaking',
        `contract kind changed: ${was.kind} → ${is.kind}`,
      );
    }

    diffForm(name, 'input', was.input, is.input, changes);
    diffForm(name, 'output', was.output, is.output, changes);
    diffErrors(name, was, is, changes);
  }

  return {
    breaking: changes.of('breaking'),
    additive: changes.of('additive'),
    unknown: changes.of('unknown'),
    contracts: changes.contracts(),
  };
}

/** Одна строка расхождения для человека */
const line = (change: CompatibilityChange): string =>
  `  - ${change.contract}${change.path ? ` ${change.path}` : ''} — ` +
  `${change.description}`;

/**
 * Печатает отчёт человеку.
 *
 * Секции по вердиктам со счётчиками; непустая секция `unknown` несёт
 * строку про конвертер — без него листья непрозрачны, и отчёт честно об
 * этом говорит, вместо того чтобы молчать.
 *
 * @param report - Отчёт, построенный `diffContracts`
 * @returns Многострочный текст; сравнивать в тесте следует **значение**
 * отчёта, а не эту строку
 */
export function formatCompatibility(report: CompatibilityReport): string {
  const lines: string[] = [
    `Contract compatibility: ${report.breaking.length} breaking, ` +
      `${report.additive.length} additive, ${report.unknown.length} unknown`,
  ];

  const sections: readonly [
    CompatibilityVerdict,
    readonly CompatibilityChange[],
  ][] = [
    ['breaking', report.breaking],
    ['additive', report.additive],
    ['unknown', report.unknown],
  ];

  for (const [verdict, changes] of sections) {
    if (changes.length === 0) {
      continue;
    }

    lines.push('', `${verdict} (${changes.length}):`, ...changes.map(line));
  }

  if (report.unknown.length > 0) {
    lines.push(
      '',
      "  Connect a schema converter (SchemaDocConverter) for these leaves' " +
        "vendors to turn 'unknown' into a verdict.",
    );
  }

  const bumps = report.contracts.filter(
    (contract) => contract.suggestedName !== undefined,
  );

  if (bumps.length > 0) {
    lines.push(
      '',
      'suggested name bumps:',
      ...bumps.map(
        (contract) => `  - ${contract.contract} → ${contract.suggestedName}`,
      ),
    );
  }

  return lines.join('\n');
}
