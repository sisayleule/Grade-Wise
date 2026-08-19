# SGMS — Preview run doc

Next.js 15 app (horizon-tailwind-react-nextjs). Run `npm run dev` to serve on http://localhost:3000.

## Reproduce the uncommitted artifacts

No environment files are required. `next.config.js` reads `NEXT_PUBLIC_BASE_PATH` but it is optional — every use falls back to `''`, so the dev server works with no `.env` files at all.

Dependencies: `node_modules/` is already installed in this checkout. On a fresh checkout, install with the project's package manager and `.npmrc` settings (legacy peer deps):

```
npm install
```

Do not copy `.env.local` or any other env files — there are none in the main checkout.

## Run the server

```
npm run dev
```

Default port 3000. If busy, pass a free port: `npm run dev -- -p 3001`. Next 15 dev servers must be killed with their process tree (`taskkill /PID <pid> /T /F` on Windows) — a `Ctrl+C`/SIGTERM to the npm wrapper may leave the child `next dev` process listening.
