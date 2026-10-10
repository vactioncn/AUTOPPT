FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
ARG AUTOPPT_BUILD_GIT_SHA
ARG AUTOPPT_BUILD_TIME
ENV AUTOPPT_BUILD_GIT_SHA=$AUTOPPT_BUILD_GIT_SHA AUTOPPT_BUILD_TIME=$AUTOPPT_BUILD_TIME AUTOPPT_RUNTIME_MODE=hosted
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 AUTOPPT_HOSTED_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/build-info.json ./build-info.json
COPY --from=build --chown=node:node /app/scripts/hosted-admin.mjs ./scripts/hosted-admin.mjs
COPY --from=build --chown=node:node /app/scripts/hosted-backup.mjs ./scripts/hosted-backup.mjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4318
CMD ["node", "server/hosted/index.mjs"]
