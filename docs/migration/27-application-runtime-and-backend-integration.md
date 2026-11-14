# Stage 4 — application runtime and backend integration checkpoint

Date: 2026-11-06
Source: repository files on `migration/neon-preparation` and read-only Vercel project metadata.

## Confirmed application stack

- The project is a TanStack Start application (React 19 / TanStack Router and Start).
- `src/start.ts` configures request middleware, error handling, and CSRF protection for server functions.
- `src/server.ts` is the server entry wrapper that loads `@tanstack/react-start/server-entry`.
- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`. Its comments say the shared config installs TanStack Start and Nitro, with Cloudflare as the default Nitro target unless configured.
- The Vercel project `mobflow-pos-stock` reports framework `tanstack-start-lovable`, Node 24, and the known production domain `mobflow-pos-stock.vercel.app`.
- `src/lib/supabase.ts` creates the browser Supabase client using the project's publishable key and browser localStorage/sessionStorage adapter. It persists/refreshes sessions under `mobflow-auth-session`.
- The frontend uses Supabase Auth directly. No Neon database driver is currently listed in package.json.
- The project package currently has no explicit `pg` or `@neondatabase/serverless` dependency.

## Implications for the temporary identity bridge

A server runtime already exists through TanStack Start, so a test-only server function/API path may be feasible without changing the visual interface. However, do not assume the Vercel and Nitro runtime settings are interchangeable. Before implementing database calls, verify the actual deployed runtime, environment-variable injection, connection reuse model, and supported Node/Postgres driver.

For the first test implementation:
- Keep `src/lib/supabase.ts` and browser Auth untouched.
- Add any Neon driver only in a separate migration branch after confirming the runtime.
- Keep Neon connection strings exclusively in server-side environment variables.
- Verify the Supabase access token server-side; never use the publishable key as a JWT verification secret.
- Use one transaction per request and transaction-local identity context.
- Do not expose a Neon URL, privileged database role, or general SQL endpoint to the browser.
- Preserve current client-side polling and Supabase Realtime until a later, separately validated phase.

## Files inspected

- `src/server.ts`
- `src/start.ts`
- `src/lib/supabase.ts`
- `vite.config.ts`
- `package.json`

## Not changed

No application source, package manifest, lockfile, environment variable, deployment setting, Vercel project, or production Supabase resource was modified. No deployment was created.
