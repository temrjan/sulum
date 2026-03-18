FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev
RUN npx prisma generate

FROM node:20-alpine

RUN apk add --no-cache curl
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup tsconfig.json ./
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup documents ./documents
COPY --chown=appuser:appgroup documents_uz ./documents_uz
COPY --chown=appuser:appgroup www ./www

RUN mkdir -p /app/temp && chown appuser:appgroup /app/temp

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--import", "tsx", "src/index.ts"]
