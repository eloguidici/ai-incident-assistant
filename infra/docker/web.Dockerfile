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
COPY apps/web apps/web
RUN npm run build -w @app/web

FROM nginx:1.27-alpine
ENV API_UPSTREAM=api:3000
ENV API_PROXY_READ_TIMEOUT=30s
COPY infra/docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
