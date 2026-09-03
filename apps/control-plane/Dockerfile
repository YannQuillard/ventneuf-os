FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
RUN npm ci

COPY apps/control-plane apps/control-plane
COPY packages/domain packages/domain
COPY packages/database packages/database
RUN npm run build --workspace @ventneuf/domain \
  && npm run build --workspace @ventneuf/database \
  && npm run build --workspace @ventneuf/control-plane \
  && npm prune --omit=dev --workspaces

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime

ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=8787

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/control-plane apps/control-plane
COPY --from=build --chown=node:node /app/packages/domain packages/domain
COPY --from=build --chown=node:node /app/packages/database packages/database

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/control-plane/dist/index.js"]
