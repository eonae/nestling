## MODIFIED Requirements

### Requirement: Скилл называет каждый публикуемый пакет фреймворка

Раздел «Where to look next» в `SKILL.md` SHALL содержать таблицу публикуемых
пакетов: имя пакета и одно предложение о том, когда он нужен. Таблица SHALL
называть по меньшей мере `@nestlingjs/outbox`, `@nestlingjs/subscriptions`,
`@nestlingjs/schema.zod`, `@nestlingjs/transport.cli`, `@nestlingjs/client`
и `@nestlingjs/eslint-plugin`.

Строка `@nestlingjs/schema.zod` SHALL называть оба повода взять пакет:
сверку схемы с уже существующим TypeScript-типом и конвертер для вендора,
отличного от вендора фреймворка. Удалённых пакетов таблица SHALL NOT
называть.

Таблица SHALL стоять внутри раздела «Where to look next»: новых заголовков
второго уровня в `SKILL.md` SHALL NOT появляться.

#### Scenario: Пакет без упоминания

- **WHEN** агенту нужна гарантированная доставка события наружу
- **THEN** `SKILL.md` называет `@nestlingjs/outbox` и повод его взять

#### Scenario: Схема под существующий тип

- **WHEN** у агента уже есть TypeScript-тип, и схема обязана описывать
  именно его
- **THEN** `SKILL.md` называет `@nestlingjs/schema.zod`

#### Scenario: Удалённого пакета в таблице нет

- **WHEN** таблица пакетов просматривается на строку `@nestlingjs/models`
- **THEN** её там нет

#### Scenario: Состав частей не изменился

- **WHEN** таблица пакетов правится
- **THEN** заголовков второго уровня в `SKILL.md` по-прежнему пять, и
  проверка структуры молчит
