# RidePass app — zero npm dependencies, just Node.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY bench ./bench
ENV NODE_ENV=production PORT=8080 DB_PATH=/app/data/ridepass.db DATA_DIR=/app/data
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["npm", "start"]
