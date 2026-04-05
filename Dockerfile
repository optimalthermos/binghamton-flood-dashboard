FROM node:20-slim

# Python + GDAL for CPC soil moisture GeoTIFF extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 python3-pip gdal-bin python3-gdal libgdal-dev \
    && python3 -m pip install --break-system-packages rasterio \
    && apt-get purge -y libgdal-dev && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

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
