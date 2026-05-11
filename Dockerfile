FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV PORT=4099
EXPOSE 4099

CMD ["node", "server.js"]
