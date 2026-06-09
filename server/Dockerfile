FROM node:20-alpine

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY dist ./dist

RUN mkdir -p /app/data

EXPOSE 3777

ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config.yaml

CMD ["node", "dist/index.js"]
