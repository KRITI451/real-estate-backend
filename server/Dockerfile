FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm i

COPY server/ ./
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "dist/index.js"]
