FROM node:22-bookworm-slim AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM debian:bookworm-slim AS obsidian-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake ninja-build ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCONSOLE_ONLY=ON -DCMAKE_INSTALL_PREFIX=/opt/obsidian && cmake --build build --parallel "$(nproc)" && cmake --install build --prefix /opt/obsidian

FROM golang:1.23-bookworm AS app-build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src/web
COPY web/go.mod ./
RUN go mod download
COPY web/ ./
RUN CGO_ENABLED=1 go build -trimpath -o /out/obsidian-web .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd -r obsidian && useradd -r -g obsidian -m -d /home/obsidian obsidian && mkdir -p /app/dist /data /wads /config && chown -R obsidian:obsidian /app /data /wads /config /home/obsidian
COPY --from=obsidian-build /opt/obsidian /opt/obsidian
COPY --from=app-build /out/obsidian-web /usr/local/bin/obsidian-web
COPY --from=frontend /web/dist /app/dist
ENV ADDR=:8080 DATABASE_PATH=/data/jobs.db WAD_DIR=/wads WEB_DIR=/app/dist OBSIDIAN_BIN=/opt/obsidian/obsidian OBSIDIAN_HOME=/opt/obsidian
VOLUME ["/data", "/wads", "/config"]
EXPOSE 8080
USER obsidian
ENTRYPOINT ["/usr/local/bin/obsidian-web"]
