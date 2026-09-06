## MODIFIED Requirements

### Requirement: Ручку исключает из документа только `doc.hidden`

Декларация с `doc: { hidden: '<причина>' }` SHALL исключаться из
документа и SHALL NOT проверяться на конвертируемость схем. Иных способов
не документировать HTTP-endpoint SHALL NOT существовать: если документация
включена, недокументируемых endpoint'ов в приложении не бывает.

Модуль-издатель SHALL писать список скрытых endpoint'ов с их причинами на
старте через `Logger$('nestling:openapi')` — по одной записи уровня
`info` на endpoint с полями `pattern`, `module` и `reason`; в сам документ
список SHALL NOT попадать. Опция `announceHidden: false` SHALL отключать
записи.

#### Scenario: Скрытый endpoint

- **WHEN** endpoint `GET /health` объявлен с
  `doc: { hidden: 'liveness-проба балансировщика' }`
- **THEN** его нет в `paths`, его схемы не проверяются на конвертируемость, а
  на старте в логгер уходит `info` с его паттерном и причиной

#### Scenario: Скрытие не заменяет конвертер

- **WHEN** endpoint без конвертера **не** помечен `hidden`
- **THEN** сборка падает: пропустить его молча нельзя
