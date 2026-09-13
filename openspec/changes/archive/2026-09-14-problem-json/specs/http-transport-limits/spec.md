## MODIFIED Requirements

### Requirement: Request body size is limited

HTTP-транспорт SHALL ограничивать размер буферизуемого тела запроса
(JSON, raw, text) значением `maxBodySize` (дефолт 1 MiB) и прерывать чтение
сразу при превышении, отвечая `413` документом RFC 9457 с
`type: "urn:error:payload_too_large"`, `detail: "Payload too large"` и
расширением `details`, называющим лимит. Значение `0` SHALL отключать
лимит.

#### Scenario: Oversized JSON body

- **WHEN** на JSON-endpoint приходит тело размером больше `maxBodySize`
- **THEN** транспорт отвечает 413 с медиатипом `application/problem+json`,
  не буферизуя тело целиком

#### Scenario: Limit disabled explicitly

- **WHEN** транспорт создан с `maxBodySize: 0` и приходит тело 10 MiB
- **THEN** запрос обрабатывается без ошибки 413
