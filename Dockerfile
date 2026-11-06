# 产物在 /app，数据目录默认用环境变量 TRANSYT_DATA_ROOT=/data（可挂载卷）。
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TRANSYT_DATA_ROOT=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY scripts ./scripts

EXPOSE 3000
CMD ["npm", "start"]
