# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS build
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run prisma:generate && npm run build

FROM build AS migration
CMD ["npm", "run", "db:deploy"]

FROM build AS production-dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
