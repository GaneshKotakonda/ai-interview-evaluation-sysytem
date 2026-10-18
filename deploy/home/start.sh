#!/usr/bin/env bash
# Start the backend on this computer and print its public tunnel address.
#   ./start.sh            start (or restart) everything and show the address
#   ./start.sh --deploy   also rebuild the Vercel website with that address
# Run from deploy/home. See docs/DEPLOY_VERCEL_HOME.md.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing deploy/home/.env. Run: cp .env.example .env  and fill it in." >&2
  exit 1
fi
API_PORT=$(grep -E '^API_PORT=' .env | cut -d= -f2- || true)
API_PORT=${API_PORT:-8000}

echo "Starting the database, API, code runner and tunnel..."
docker compose up -d --build

echo "Waiting for the API to load its models (about a minute the first time)..."
for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null && break
  sleep 2
done
curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null \
  || { echo "The API did not become healthy. Check: docker compose logs api" >&2; exit 1; }

echo "Waiting for the tunnel address..."
# Only read logs from the tunnel's current run: after a stop and start, its
# earlier logs still hold the old, dead address.
TUNNEL_STARTED=$(docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q tunnel)")
URL=""
for _ in $(seq 1 45); do
  URL=$(docker compose logs --since "$TUNNEL_STARTED" tunnel 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$URL" ] && break
  sleep 2
done
[ -n "$URL" ] || { echo "No tunnel address yet. Check: docker compose logs tunnel" >&2; exit 1; }

# A new quick-tunnel address can take a minute or two to answer.
echo "Checking the API through the tunnel (up to 3 minutes)..."
for _ in $(seq 1 90); do
  curl -sf "${URL}/api/health" >/dev/null && break
  sleep 2
done
curl -sf "${URL}/api/health" >/dev/null \
  || { echo "The tunnel address does not answer yet: ${URL}  (try again in a minute)" >&2; exit 1; }

echo
echo "Backend is public at: ${URL}"

if [ "${1:-}" = "--deploy" ]; then
  # Build the website here with the backend address baked in, then upload
  # only the finished files from site/ (linked to the Vercel project), so
  # Vercel never sees or tries to build the Python backend.
  echo "Building the website for ${URL}..."
  (cd ../.. && VITE_API_BASE_URL="${URL}" npm run build)
  mkdir -p site
  find site -mindepth 1 -maxdepth 1 ! -name .vercel ! -name .env.local ! -name .gitignore -exec rm -rf {} +
  cp -R ../../dist/. site/
  cp vercel.json site/vercel.json
  if [ ! -d site/.vercel ]; then
    (cd site && npx --yes vercel link --yes --project "${VERCEL_PROJECT:-ai-interview-evaluation}")
  fi
  echo "Uploading the website to Vercel..."
  (cd site && npx --yes vercel deploy --prod --yes)
else
  echo "If this address changed since the last Vercel build, run:  ./start.sh --deploy"
fi
