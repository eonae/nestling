# Образ приложения: сборка идёт в монорепе, наружу уезжает один бандл.
#
# Контекст сборки — корень репозитория: пример собирается вместе с
# пакетами, на которые ссылается `workspace:*`.
FROM node:24-alpine AS build

WORKDIR /repo

RUN corepack enable

COPY . .

RUN yarn install --immutable
RUN yarn workspace @examples/modular-app run build

FROM node:24-alpine AS runtime

WORKDIR /app

# Бандл самодостаточен: `esbuild` уложил в него и код примера, и пакеты
COPY --from=build /repo/examples/modular-app/dist/bundle.js ./bundle.js

CMD ["node", "bundle.js"]
