FROM node:20-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL dependencies (including devDependencies for the build step)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the project (creates dist/)
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["node", "dist/index.cjs"]
