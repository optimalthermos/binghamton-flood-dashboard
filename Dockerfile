FROM node:20-slim

# System dependencies: curl for healthcheck, python3 for soil moisture script,
# ffmpeg for NYSDOT webcam frame extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Try to install rasterio (for soil moisture GeoTIFF extraction)
# If it fails (missing GDAL headers), the endpoint degrades gracefully
RUN python3 -m pip install --break-system-packages rasterio 2>/dev/null || \
    echo "rasterio install failed — soil moisture will show as unavailable"

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
