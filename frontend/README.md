# Copy Trader admin UI

Next.js frontend for the FastAPI backend in the parent directory. Setup and
features are described in the [main README](../README.md#admin-ui).

```bash
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_URL
npm run dev                  # http://localhost:3000
npm run build && npm start   # production
```

| Path | Contents |
|---|---|
| `src/app/` | Routes: `/` dashboard, `/accounts`, `/settings` and the root layout |
| `src/components/` | Sidebar, topbar, stat cards, status badges, per-page views |
| `src/components/ui/` | shadcn/ui components (Base UI style `base-nova`) |
| `src/lib/api.ts` | Typed API client; adds the `X-Admin-Token` header |
| `src/lib/schemas.ts` | Zod form schemas and API response types |
| `src/hooks/use-api.ts` | TanStack Query hooks; status views poll every 5s |
