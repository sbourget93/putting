# Development image: runs the Vite dev server with HMR.
# local/docker-compose.yml bind-mounts the source over /app, so this image only
# owns the dependency install.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host binds 0.0.0.0 so the port is reachable from outside the container.
CMD ["npm", "run", "dev", "--", "--host"]
