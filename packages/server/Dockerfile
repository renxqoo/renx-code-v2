FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile=false

COPY packages/core packages/core
COPY packages/server packages/server

RUN pnpm --filter @renx-code/server build

ENV RENX_SERVER_HOST=0.0.0.0
ENV RENX_SERVER_PORT=8080
ENV RENX_STATE_DIR=/data/renx-state
ENV RENX_WORKSPACE_DIR=/data/workspace

EXPOSE 8080

CMD ["node", "packages/server/dist/index.js"]
