# Build: install all dependencies and compile, then drop the dev ones.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
# Apply migrations and upsert the demo users, then start the API (with its email worker).
CMD ["sh", "-c", "node dist/database/seed.js && node dist/main.js"]
