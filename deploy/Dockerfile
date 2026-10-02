# Builds the React app once, then bundles it straight into the proxy image
# that serves it — no frontend container in production, and no runtime
# volume to keep a build's output in sync with the image running it.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/frontend
