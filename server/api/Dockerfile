FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Volume for the SQLite database, writable by the unprivileged user.
RUN mkdir -p /data && chown node:node /data
USER node

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
