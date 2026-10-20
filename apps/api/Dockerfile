# The API, for Cloud Run (or any container host). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t v01-api .
FROM node:22-slim AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @v01/api build
# Only what runs: the bundle and the npm packages it loads.
RUN pnpm prune --prod

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
# Cloud Run sets PORT; the API listens on it.
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/server.js"]
