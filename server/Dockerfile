FROM node:18-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./
RUN npm install --production

# Copy server source code
COPY server/ ./

# Copy frontend files to public directory
COPY index.html ./public/
COPY pages/ ./public/pages/
COPY assets/ ./public/assets/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Run init-db first (creates tables + seeds admin), then start the server
CMD ["sh", "-c", "node src/scripts/initDb.js && node src/app.js"]
