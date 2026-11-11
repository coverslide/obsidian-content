# Obsidian Web

Browser interface for generating Obsidian maps. Go runs the job queue and persists job metadata and submitted settings in SQLite; Vite builds the TypeScript custom-element frontend using `@coverslide/customelement`. The service loads Obsidian's option reference from `--printref-json` and presents its settings in collapsible groups. Generated WAD files stay in a persistent volume and can be downloaded from the job list.

## Run with Docker Compose

From this directory:

```sh
docker compose up --build
```

Open <http://localhost:8080>. Compose creates persistent `obsidian-data` and `obsidian-wads` volumes. Put optional `CONFIG.txt` or `OPTIONS.txt` files in `web/config/` to apply them to generated maps. Set `OBSIDIAN_WEB_PORT` to change the host port.

## Run frontend and API locally

```sh
npm install
npm run dev
```

Run the Go API with `go run .` from this directory after installing the module dependencies. The API defaults to `/opt/obsidian/obsidian`, `/data/jobs.db`, and `/wads`; configure `OBSIDIAN_BIN`, `DATABASE_PATH`, `WAD_DIR`, and `WEB_DIR` for a local setup.

SQLite migrations are versioned SQL files under `migrations/` and are applied at service startup. New migrations should use the next numeric prefix and remain additive.

## Tests

Install the Playwright Chromium browser once with `npx playwright install chromium`. Then run `npm test` to run the TypeScript unit suite, Playwright browser suite, and Go backend suite. Run an individual suite with `npm run test:unit`, `npm run test:e2e`, or `npm run test:backend`.
