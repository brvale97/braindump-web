# Braindump Web

Cloudflare Pages app voor snelle braindumps naar een GitHub-repo, met een persoonlijke inbox/overview flow als primaire use-case en aparte `Shared` en `GeP` surfaces.

## Architectuur
- Frontend: vanilla browser ESM onder [public/js](D:/projects-t3code/braindump-web/public/js)
- Backend: Cloudflare Pages Functions onder [functions/api](D:/projects-t3code/braindump-web/functions/api)
- Gedeelde backendlogica: [functions/lib](D:/projects-t3code/braindump-web/functions/lib)
- Data-opslag: markdownbestanden in een GitHub-repo, benaderd via de GitHub Contents API

## Belangrijke routes
- `POST /api/auth`: login met PIN, zet een `HttpOnly` sessiecookie
- `GET /api/auth/session`: leest huidige sessie
- `POST /api/auth/logout`: wist sessiecookie
- `GET|POST|PATCH|PUT|DELETE /api/inbox`: persoonlijke inbox
- `GET|POST|PATCH|DELETE /api/shared`: gedeelde inbox
- `GET|POST|PATCH|DELETE /api/gep`: GeP inbox
- `GET|POST|PUT|PATCH /api/overview`: overview, done/move/edit/reorder/context
- `POST /api/upload`: uploadt bestand naar `uploads/YYYY-MM/...` en voegt inbox-item toe
- `GET /api/image?path=uploads/...`: beveiligde image proxy voor private repo-assets

## Environment variables
- `GITHUB_TOKEN`: PAT met contents read/write voor de datarepo
- `PIN_HASH`: SHA-256 hash van Bram’s PIN
- `ANNA_PIN_HASH`: optionele SHA-256 hash voor Anna
- `SESSION_SECRET`: HMAC-secret voor sessietokens
- `REPO_OWNER`: optioneel override voor repo owner
- `REPO_NAME`: optioneel override voor repo name
- `REPO_BRANCH`: optioneel override voor branch, default `main`

## Lokale development
```bash
npm install
npm run dev
```

Open daarna de lokale Pages dev server van Wrangler.

## Checks en tests
```bash
npm run check
```

Dit draait:
- unit tests voor parser/sessie
- Playwright smoke tests tegen een statische lokale server

## Deploy
```bash
npm run deploy
```

Voor productie:
- zet de secrets in Cloudflare Pages
- zorg dat `public/_headers` mee deployed wordt
- CI draait via [`.github/workflows/ci.yml`](D:/projects-t3code/braindump-web/.github/workflows/ci.yml)

## Richting
- Quick-dump-first blijft leidend
- GitHub-markdown blijft de bron van waarheid
- Persoonlijke flow heeft voorrang op `Shared` en `GeP`
