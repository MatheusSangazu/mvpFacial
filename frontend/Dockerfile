# Frontend Next.js - imagem multi-estagio com output standalone (imagem final ~150MB)
# ADR-020: deploy em containers via Coolify
FROM node:20-alpine AS deps
WORKDIR /app
# Nao usar --omit=optional: Next.js 16 precisa dos binarios SWC especificos
# da plataforma (ex: @next/swc-linux-x64-musl no Alpine). Sem eles o build falha.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
