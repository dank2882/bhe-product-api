FROM node:22-slim
WORKDIR /app
COPY services/maintenance-worker/package*.json ./services/maintenance-worker/
RUN npm ci --prefix services/maintenance-worker --omit=dev && npm cache clean --force
COPY lib ./lib
COPY services/maintenance-worker ./services/maintenance-worker
ENV NODE_ENV=production
CMD ["node", "services/maintenance-worker/index.js"]
