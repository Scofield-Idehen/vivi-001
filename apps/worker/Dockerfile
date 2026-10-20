# The worker, for Cloud Run (or any container host). Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t v01-worker .
# It runs its own loops; on Cloud Run keep one instance always on (min 1, max 1, CPU always
# allocated). It answers /health on PORT so the host knows it is alive.
FROM node:22-slim AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @v01/worker build
RUN pnpm prune --prod

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/worker
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.js"]
