# --- deps + build stage ---
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time,
# so this has to be a build-arg, not a runtime env var.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8005
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN npm run build

# --- runtime stage ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3005
ENV PORT=3005
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
