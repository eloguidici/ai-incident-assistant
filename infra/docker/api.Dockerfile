FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=secret,id=extra_ca_cert,required=false \
  sh -ec 'if [ -f /run/secrets/extra_ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca_cert; fi; npm ci'
COPY apps/api apps/api
RUN npm run build -w @app/api

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=secret,id=extra_ca_cert,required=false \
  sh -ec 'if [ -f /run/secrets/extra_ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca_cert; fi; npm ci --omit=dev'
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/src/db/migrations apps/api/dist/db/migrations
WORKDIR /app/apps/api
RUN chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
