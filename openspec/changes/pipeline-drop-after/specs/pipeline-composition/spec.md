# pipeline-composition

## MODIFIED Requirements

### Requirement: compose объединяет слои с порядком «снаружи внутрь»

`compose(outer, ..., inner)` SHALL объединять слои в один пайплайн:
список читается сверху вниз как «снаружи внутрь». Рантайм SHALL исполнять
pre-тракты слоёв снаружи внутрь, ответные тракты — изнутри наружу,
`finally` — изнутри наружу. Внутри одного слоя ответный тракт SHALL
оставаться единым списком юнитов в порядке объявления с применимостью
по текущему ответу; композиция задаёт порядок **слоёв**, а не порядок
видов юнитов.

#### Scenario: Порядок исполнения при композиции

- **WHEN** `compose(base, authed)` и запрос успешен
- **THEN** порядок: pre(base) → pre(authed) → handler → ok(authed) →
  ok(base) → finally(authed) → finally(base)

#### Scenario: Порядок при ответе-ошибке

- **WHEN** `compose(base, authed)`, оба слоя объявили `.ok` и `.catch`,
  и хендлер вернул `Fail`
- **THEN** порядок: catch(authed) → catch(base) → finally(authed) →
  finally(base); `.ok`-юниты обоих слоёв не исполняются
