FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w @app/api && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY apps/api/src/db/migrations apps/api/dist/db/migrations
WORKDIR /app/apps/api
RUN chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
