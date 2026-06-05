# syntax=docker/dockerfile:1
#
# UNIHODL MCP server — built for the Glama hosted inspector
# (https://glama.ai/mcp/servers/FutureEnterprises/unihodl).
#
# The server speaks the Model Context Protocol over stdio. Build context is the
# repository root; the server source lives in packages/mcp-server.

FROM node:20-alpine AS build
WORKDIR /srv
# Manifest first for layer caching. No package-lock is published to this repo,
# so we use `npm install` (not `npm ci`).
COPY packages/mcp-server/package.json ./
RUN npm install --no-audit --no-fund
# Source + TypeScript build (tsup -> dist/index.js, ESM).
COPY packages/mcp-server/tsconfig.json ./
COPY packages/mcp-server/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /srv
ENV NODE_ENV=production
# Public sandbox key so the inspector can list and call tools out of the box.
# Override UNIHODL_API_KEY with your own key from
# https://www.unihodl.app/developers
ENV UNIHODL_API_KEY=uh_test_sandbox_demo_key_v0
COPY packages/mcp-server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /srv/dist ./dist
# Drop root — run as the unprivileged built-in `node` user (container hardening).
USER node
# MCP servers communicate over stdio.
ENTRYPOINT ["node", "dist/index.js"]
