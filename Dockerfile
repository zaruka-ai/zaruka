FROM node:22-slim AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/

RUN npx tsc
RUN npm prune --production --legacy-peer-deps

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package.json ./

RUN mkdir -p /data
ENV ZARUKA_DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "dist/src/cli/index.js", "start"]
