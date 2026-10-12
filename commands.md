# Run the AI Interview Evaluation System with Docker

Everything (website, API, database and the code runner) runs in Docker on your own computer. You do not need to install Python, Node.js or PostgreSQL.

## 1. What you need

| Item | Notes |
| --- | --- |
| **Docker** | Docker Desktop (Windows / macOS) or Docker Engine + Compose plugin (Linux). Check with `docker --version` and `docker compose version`. |
| **Free disk space** | About 10 GB (the images contain the speech and identity models). |
| **Memory** | 8 GB RAM is comfortable; give Docker at least 4 GB. |
| **Browser** | Chrome or Edge, with a working camera and microphone. |
| **Internet** | Needed for the first build, for sign-in (Firebase) and for the AI grading (Gemini). |
| **Gemini API key** | Free from https://aistudio.google.com/apikey. Without a key the app still runs, but questions come from a fixed bank and grading is approximate. |

Windows: start Docker Desktop first and wait until it says it is running. Run the commands in PowerShell or Git Bash.

## 2. Get the code

```bash
git clone https://github.com/GaneshKotakonda/ai-interview-evaluation-sysytem.git
cd ai-interview-evaluation-sysytem
git checkout Shafreed
cd deploy/local
```

## 3. Add your settings

Linux / macOS / Git Bash:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
copy .env.example .env
```

Open the new `.env` file in any text editor and paste your key after `GEMINI_API_KEY=`:

```env
GEMINI_API_KEY=your-own-key
```

Leave the other values as they are. Never share or commit your `.env` file.

## 4. Build and start

```bash
docker compose up -d --build
```

The first build takes **10-20 minutes** (it downloads the speech models and voices). Later starts take seconds.

Check that everything is running:

```bash
docker compose ps
```

All four services (`db`, `api`, `runner`, `web`) should show `running` (the `db` and `api` ones may show `healthy`). The first time, the API needs about a minute after starting to load its models. You can watch it:

```bash
docker compose logs -f api
```

Press `Ctrl+C` to stop watching (the app keeps running). It is ready when you see `Application startup complete`.

## 5. Use the application

Open **http://localhost:8080** in Chrome or Edge.

1. Sign up with any email and password.
2. Choose a role on the **Readiness** page, optionally upload a resume, and pick the interviewer voice and accent (a sample plays when you change it).
3. Allow the camera and microphone when the browser asks, tick the consent box and start the interview.

Use `localhost` exactly as written. The browser only allows the camera and microphone on `localhost` or HTTPS.

## 6. What to test

| Area | How |
| --- | --- |
| Voice interview | Answer out loud; 3 seconds of silence moves on, or select Next |
| Strict scoring | Say "skip" to every question: the report shows 0 and the "insufficient responses" notice |
| Resume questions | Upload a resume on Readiness: some questions ask about its projects and skills |
| Voices | Try Female / Male and American / British on Readiness |
| Gaze warnings | Look away from the screen for 3+ seconds: a banner asks you to look at the screen |
| Proctoring | Switch tab or exit fullscreen: warning. 3 warnings (or 5 seconds away) end the interview |
| Background sound | Play music while you are silent for 6+ seconds: a warning appears |
| Coding round | Questions 2 and 4 open the code editor with test cases |
| Report | Scores, completion rate, integrity section and recording playback |

## 7. Everyday commands

Run these from the `deploy/local` folder.

| Do this | Command |
| --- | --- |
| Stop the app (keeps your data) | `docker compose stop` |
| Start it again | `docker compose start` |
| See the logs | `docker compose logs -f api` |
| Update to the latest code | `git pull` then `docker compose up -d --build` |
| Stop and remove the containers (keeps data) | `docker compose down` |
| Remove everything including data | `docker compose down -v` |

If the code changed the database layout after you first started, run `docker compose down -v` once and start again, so the database is created from the new `schema.sql`.

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| `docker: command not found` / cannot connect to the Docker daemon | Install Docker and start it (Docker Desktop must be open). |
| Port 8080 is already in use | Open `.env`, set `WEB_PORT=8090`, run `docker compose up -d`, then open http://localhost:8090 |
| Page loads but sign-up fails or the API errors | Run `docker compose logs api` and check for errors. Wait a minute after starting, the API loads its models first. |
| "Camera or microphone not found" | Allow them for localhost in the browser's site settings; close other apps that use the camera. |
| Voice answers are slow the first time | The speech model warms up on the first use. Later answers are faster. |
| Questions look generic / grading says "approximate" | `GEMINI_API_KEY` is missing or wrong in `.env`. Fix it and run `docker compose up -d`. |
| Build fails while downloading | Check your internet connection and run `docker compose up -d --build` again. |
| Windows: build is very slow or runs out of memory | In Docker Desktop settings, give Docker at least 4 GB of memory. |

## 9. Remove everything when you are done

```bash
docker compose down -v --rmi all
```
