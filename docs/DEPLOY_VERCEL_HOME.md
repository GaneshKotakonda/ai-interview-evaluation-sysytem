# Deploy: website on Vercel, backend on your computer

```
Browser ──HTTPS──> Vercel (React website)
   │
   └──HTTPS──> https://<random>.trycloudflare.com ──tunnel──> your computer (Docker)
                                                              ├─ API (FastAPI + models)
                                                              ├─ PostgreSQL   (never public)
                                                              └─ code runner  (no internet)
```

- **Website:** built on your computer and uploaded to Vercel as finished files from `deploy/home/site` (settings in `deploy/home/vercel.json`). Vercel never sees the Python backend, so it never tries to build it.
- **Backend:** `deploy/home` runs the API, database and code runner in Docker on your computer.
- **Tunnel:** a Cloudflare *quick tunnel* gives the API a public HTTPS address without router settings or a domain. The address is random and **changes every time the tunnel restarts**.
- Because Vite builds the backend address into the website, a new tunnel address means rebuilding and re-uploading the website. `./start.sh --deploy` does both.

## One-time setup

1. **Vercel account:** sign up for a free Hobby account at https://vercel.com.
2. **Log in:** `npx vercel login`. The first `./start.sh --deploy` creates and links the Vercel project `ai-interview-evaluation` in `deploy/home/site` (set `VERCEL_PROJECT` to use another name). Note the production address it prints: ours is `https://ai-interview-evaluation-nine.vercel.app` (Vercel adds a suffix when the plain name is taken).
   Do not run `vercel link` from the repository root: the Vercel CLI then detects both the website and the FastAPI backend and refuses to continue.
3. **Backend settings:** in `deploy/home`, copy `.env.example` to `.env` (already done on Shafreed's computer) and set:
   - `GEMINI_API_KEY`: your key.
   - `CORS_ORIGINS`: the exact Vercel address from step 2 (no trailing slash).
   - `POSTGRES_PASSWORD` and `RUNNER_TOKEN`: long random strings.
4. **Firebase sign-in:** Firebase console → project `ai-evaluation-40c8a` → Authentication → Settings → **Authorized domains** → add your Vercel domain (ours: `ai-interview-evaluation-nine.vercel.app`).

## Every time you start it

From `deploy/home`:

```bash
./start.sh --deploy
```

It builds and starts everything, waits until the API is healthy, reads the tunnel address, checks the API through it, builds the website with that address and uploads it to Vercel. Then open your Vercel address.

If only the backend restarted and the tunnel address did not change, `./start.sh` (without `--deploy`) is enough. The script tells you the current address.

## Keep it running

- Your computer must stay **on, awake and online** while people use the app. Plug it in and turn off sleep.
- Check it: `curl http://127.0.0.1:8000/api/health` (this computer) or `<tunnel address>/api/health` (anywhere).
- Logs: `docker compose logs -f api` and `docker compose logs tunnel`.
- Stop: `docker compose stop`. The next start gives a **new** tunnel address, so use `./start.sh --deploy` again.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Website says it cannot reach the server / "Failed to fetch" | The tunnel address changed. Run `./start.sh --deploy`. |
| Browser console shows a CORS error | `CORS_ORIGINS` in `.env` must match the Vercel address exactly. Fix it, then `docker compose up -d api`. |
| Sign-in fails on the Vercel site | Add the Vercel domain to Firebase **Authorized domains** (setup step 4). |
| `column … does not exist` after `git pull` | `docker compose exec -T db psql -U interview -d interviews -v ON_ERROR_STOP=1 < ../../schema.sql` |
| `vercel` asks to log in | Run `npx vercel login`, then `./start.sh --deploy` again. |
| Vercel error about `services` or detecting a backend | A `vercel` command was run from the repository root. Deploy only through `./start.sh --deploy`. |

## Limits to know

- **Quick tunnels are for testing:** Cloudflare gives no uptime guarantee, and the address changes on every restart. A fixed address needs a domain on Cloudflare (a "named tunnel").
- **Speed:** the app is as fast as your computer and your home upload connection.
- **Separate data:** this setup has its own database. Interviews from `deploy/local` are not copied.
- **Recordings:** they are uploaded in small chunks, so they stay well within the tunnel's upload limits.
