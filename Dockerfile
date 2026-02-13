FROM node:22-slim

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/

RUN npx tsc

# Remove dev dependencies after build
RUN npm prune --production --legacy-peer-deps

# Data directory
RUN mkdir -p /data
ENV ZARUKA_DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "dist/cli/index.js", "start"]
