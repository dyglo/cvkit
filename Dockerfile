FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY workers/ ./workers/
COPY migrations/ ./migrations/

RUN apk add --no-cache python3 py3-pip
RUN pip3 install --break-system-packages -r workers/requirements.txt

EXPOSE 8080

CMD ["node", "dist/server.js"]
