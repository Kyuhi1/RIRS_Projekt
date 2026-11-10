FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
COPY --chown=node:node db ./db
USER node
EXPOSE 3000
CMD ["npm", "start"]
