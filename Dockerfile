FROM node:20-slim

WORKDIR /app
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE ${PORT:-3456}

CMD ["node", "start.js"]
