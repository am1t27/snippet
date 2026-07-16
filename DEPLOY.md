# Deploying Snippet

Snippet has **two deployable parts** that must go to **two different kinds of host**:

| Part | What it is | Where it goes |
| --- | --- | --- |
| `client/` | Static Vite/React SPA | **Vercel** (static) |
| repo root (`server.js`, …) | Long-running, stateful Socket.IO game server (in-memory rooms + timers + WebSockets) | **A persistent host** — Railway / Render / Fly / a VM |

> **Why not all on Vercel?** The game server holds every room's state in memory and
> keeps WebSocket connections open for the life of a match. Vercel Functions are
> ephemeral and stateless and don't host a persistent Socket.IO server, so the
> backend cannot run there. Vercel hosts only the static client. (This is finding
> **C1** from the audit.)

---

## 1. Backend → Railway / Render / Fly

1. Create a service from this repo (root directory = repo root).
2. Start command: `npm start` (runs `node server.js`).
3. Set environment variables (see `.env.example`):
   - `NODE_ENV=production`
   - `CLIENT_ORIGIN=https://<your-vercel-domain>` — **required**; without it, in
     production the server blocks all cross-origin clients (fail closed, finding H3).
   - `GOOGLE_CLIENT_ID=<your OAuth web client id>` — enables verified sign-in.
   - Optional: `MAX_ROOMS`, `MAX_CONN_PER_IP`, `DATABASE_URL` (+ `npm install pg`),
     `REDIS_URL`, `SENTRY_DSN`, `LOG_FORMAT=json`.
4. Note the public URL, e.g. `https://snippet-server.up.railway.app`.

## 2. Client → Vercel

1. Import the repo in Vercel.
2. **Set the project Root Directory to `client`** (Vercel → Settings → General →
   Root Directory). This is what keeps Vercel from trying to build/run the backend.
3. Framework preset: **Vite**. Build: `npm run build`. Output: `dist`.
4. Environment variables (see `client/.env.example`):
   - `VITE_SOCKET_URL=https://<your-backend-host>` (from step 1.4).
   - `VITE_GOOGLE_CLIENT_ID=<same OAuth web client id as the backend>`.
5. Deploy. `client/vercel.json` already ships the SPA rewrite + security headers (CSP).

## 3. Google OAuth (finding H1)

The OAuth client currently authorizes only `http://localhost:5173`, so sign-in
will fail on the deployed domain until you add it:

1. Google Cloud Console → APIs & Services → Credentials → your OAuth client.
2. **Authorized JavaScript origins** → add your Vercel production URL (and any
   preview URL you use), e.g. `https://your-app.vercel.app`.
3. No redirect URI is needed (Google Identity Services uses the popup flow).

## 4. Verify

- Open the Vercel URL → the "Sign in with Google" button renders (means
  `VITE_GOOGLE_CLIENT_ID` reached the build).
- Create a room → another browser joins with the code → a round plays. This
  confirms `VITE_SOCKET_URL` and `CLIENT_ORIGIN` line up.
- Backend health check: `GET https://<backend>/` returns `{ "ok": true }`.

## Environment variable summary

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `CLIENT_ORIGIN` | backend | prod: yes | CORS/origin allowlist (fail closed in prod) |
| `GOOGLE_CLIENT_ID` | backend | for sign-in | server-side ID-token verification |
| `NODE_ENV` | backend | prod: yes | enables fail-closed CORS |
| `MAX_ROOMS` / `MAX_CONN_PER_IP` | backend | no | abuse caps (defaults 500 / 30) |
| `VITE_SOCKET_URL` | client | prod: yes | backend URL the SPA connects to |
| `VITE_GOOGLE_CLIENT_ID` | client | for sign-in | renders the Google button |
