FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/strid3r21/GrocyGo"
LABEL org.opencontainers.image.description="Lightweight Food Inventory & Shopping List server with Product + Shelf Photos, Grocy Importer, QR Onboarding, and built-in MCP server"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9283
ENV DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
VOLUME ["/data"]
EXPOSE 9283
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9283/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
