# Obsidian Web

Browser interface for generating Obsidian maps. Go runs the job queue and persists job metadata and submitted settings in SQLite; Vite builds the TypeScript custom-element frontend using `@coverslide/customelement`, which is embedded in the production Go executable. The service loads Obsidian's option reference from `--printref-json` and presents its settings in collapsible groups. Running and failed jobs show a live tail of Obsidian's log, and each run can repopulate the settings form. The latest form settings are also saved in browser local storage. Generated WAD files stay in a persistent volume and can be downloaded from the job list.

Completed Doom and Doom II jobs also have a **Play in UZDoom** link. The UZDoom WebAssembly engine and Freedoom IWADs are bundled into the same Docker image and served locally under `/play/`; the browser does not fetch the engine or fonts from a CDN. The link loads the generated WAD as a mod and starts its first map with the matching Freedoom IWAD. Cross-origin isolation headers are enabled for the WebAssembly engine's shared-memory support. The bundled engine's GPL license and attribution are in `player/`.

## Run with Docker Compose

From this directory:

```sh
docker compose up --build
```

To build the image directly from the repository root:

```sh
docker build -f Dockerfile.web -t coverslide/obsidian-runner .
```

Open <http://localhost:8080>. Compose creates persistent `obsidian-data` and `obsidian-wads` volumes. Put optional `CONFIG.txt` or `OPTIONS.txt` files in `web/config/` to apply them to generated maps. Set `OBSIDIAN_WEB_PORT` to change the host port.

## Run frontend and API locally

```sh
npm install
npm run dev
```

Run the Go API with `go run .` from this directory after installing the module dependencies. The API defaults to `/opt/obsidian/obsidian`, `/data/jobs.db`, and `/wads`. Docker Compose uses these defaults without path environment variables. The container embeds the Vite output in the Go executable.

SQLite migrations are versioned SQL files under `migrations/` and are applied at service startup. New migrations should use the next numeric prefix and remain additive.

## Tests

Install the Playwright Chromium browser once with `npx playwright install chromium`. Then run `npm test` to run the TypeScript unit suite, Playwright browser suite, and Go backend suite. Run an individual suite with `npm run test:unit`, `npm run test:e2e`, or `npm run test:backend`.
