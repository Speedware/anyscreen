FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

COPY server ./server
COPY frontend ./frontend
COPY player-web ./player-web

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/db/anyscreen.db
ENV UPLOADS_DIR=/data/uploads

VOLUME ["/data"]
EXPOSE 3001

WORKDIR /app/server
CMD ["node", "server.js"]
