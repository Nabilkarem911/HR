FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/dashboard/kpis || exit 1

# Run init-db first (creates tables + seeds admin), then start the server
CMD ["sh", "-c", "node src/scripts/initDb.js && node src/app.js"]
