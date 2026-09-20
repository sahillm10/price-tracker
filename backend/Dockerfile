# Playwright image ships Chromium + all OS deps, so it works on Render's free Docker runtime.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

# Upgrade Node to v22 (required by @supabase/supabase-js >=2.116.0)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-websocket"
EXPOSE 3000
CMD ["node", "src/server.js"]
