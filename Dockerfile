# Causa web app and POST /run API.
#   docker build -t causa .
#   docker run --rm -p 3100:3100 --env-file .env \
#     -e ZETARIS_REST_URL=http://host.docker.internal:8888/api/v1.0 \
#     -e METERLESS_BASE_URL=http://host.docker.internal:8088/v1 \
#     -e METERLESS_RUNTIME_TOKEN=<token from Nightshift's Console> causa
# Zetaris and Nightshift run on the host; the container reaches them through
# host.docker.internal. Inside the container Causa cannot read Nightshift's
# proxy-token file, so the token must be passed in. For a run with no services:
#   docker run --rm -p 3100:3100 -e SAMPLE_MODE=true -e CAUSA_OFFLINE=true causa
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY vendor ./vendor
COPY data ./data
COPY test ./test
COPY input_examples ./input_examples
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["npx", "tsx", "src/server.ts"]
