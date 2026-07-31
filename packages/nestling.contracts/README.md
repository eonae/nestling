# @nestling/contracts

Direction-neutral declarations: `makeContract`, `defineFail`, `Ok`/`Fail`, the
status vocabulary, io forms (`stream`/`events`/`multipart`/`upload`) and the
HTTP bind map.

> 🚧 Active development, API evolving. Target design:
> [`docs/design/contracts.md`](../../docs/design/contracts.md).

The package is the **single physical home** of everything a contract is made
of, and it has no server code in its import closure — that is what makes a
contract importable into a browser bundle.
