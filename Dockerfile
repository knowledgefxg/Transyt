# 产物在 /app，数据目录默认用环境变量 TRANSYT_DATA_ROOT=/data（可挂载卷）。
#
# 国内或受限网络下构建：见 README Docker 小节，可使用 build-arg 或 docker-compose.cn.yml。
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=""
RUN set -eux; \
  if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi; \
  npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TRANSYT_DATA_ROOT=/data

# 构建时传入可改用国内镜像（示例见 docker-compose.cn.yml）
ARG APT_MIRROR=""
ARG APT_SECURITY_MIRROR=""
ARG PIP_INDEX_URL=""

RUN set -eux; \
  if [ -n "$APT_MIRROR" ]; then \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i "s|https://deb.debian.org/debian|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
      sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -n "$APT_SECURITY_MIRROR" ] && [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i "s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
      sed -i "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
  fi; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    ffmpeg; \
  rm -rf /var/lib/apt/lists/*; \
  python3 -m venv /opt/transyt-venv; \
  if [ -n "$PIP_INDEX_URL" ]; then \
    /opt/transyt-venv/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" --upgrade pip; \
    /opt/transyt-venv/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" faster-whisper yt-dlp; \
  else \
    /opt/transyt-venv/bin/pip install --no-cache-dir --upgrade pip; \
    /opt/transyt-venv/bin/pip install --no-cache-dir faster-whisper yt-dlp; \
  fi

ENV TRANSYT_BUNDLED_VENV=/opt/transyt-venv

COPY package.json package-lock.json ./
ARG NPM_REGISTRY=""
RUN set -eux; \
  if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi; \
  npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY scripts ./scripts

EXPOSE 3000
CMD ["npm", "start"]
