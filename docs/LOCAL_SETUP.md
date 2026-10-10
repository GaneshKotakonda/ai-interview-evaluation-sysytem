# Local Setup for Testing (Team Guide)

How a teammate runs the whole system on their own computer, with their own local PostgreSQL database, to test it. Nothing here deploys anything or touches anyone else's data. About 30–45 minutes the first time.

## 1. What you need

| Tool | Version | Needed for | Check |
| --- | --- | --- | --- |
| Git | any | getting the code | `git --version` |
| Node.js | 20 or newer | the website (frontend) | `node --version` |
| Python | 3.12 – 3.14 | the API (backend) | `python --version` |
| PostgreSQL | 14 or newer (16 recommended) | the database | `psql --version` |
| Chrome or Edge | recent | camera, microphone, fullscreen | — |
| g++ (MinGW on Windows) | any C++17 compiler | C++ in coding questions (optional) | `g++ --version` |
| JDK | 17 or newer | Java in coding questions (optional) | `javac -version` |

Python and JavaScript coding questions work without anything extra (Node.js is already installed for the website). The code editor only offers languages your computer can run.

You also need a **Gemini API key** of your own: create one at Google AI Studio. Without a key the app still runs, but questions come from a fixed bank and grading is approximate.

## 2. Get the code

```bash
git clone https://github.com/GaneshKotakonda/ai-interview-evaluation-sysytem.git
cd ai-interview-evaluation-sysytem
git checkout Shafreed
```

## 3. Create your local database

Open **SQL Shell (psql)** (Windows) or a terminal, sign in as the `postgres` superuser with the password you chose when installing PostgreSQL, and run:

```sql
CREATE USER interview_app WITH PASSWORD 'choose-a-password';
CREATE DATABASE interview_eval OWNER interview_app;
```

Then load the tables (from the repository folder; enter the password you just chose):

```bash
psql "postgresql://interview_app:choose-a-password@localhost:5432/interview_eval" -v ON_ERROR_STOP=1 -f schema.sql
```

`schema.sql` is safe to run again at any time; do that after every `git pull` so new tables and columns are added.

## 4. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and set at least:

```env
DATABASE_URL=postgresql://interview_app:choose-a-password@localhost:5432/interview_eval
GEMINI_API_KEY=your-own-key
```

Leave `CODE_RUNNER_URL` empty: on your computer code runs locally in a temporary folder with time limits and without access to your secrets. Never commit `backend/.env`; it is git-ignored.

## 5. Install and start the backend

Windows (PowerShell or Git Bash):

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
.venv/Scripts/python backend/download_models.py
.venv/Scripts/python -m uvicorn main:app --app-dir backend --reload --port 8000
```

macOS / Linux: the same commands with `.venv/bin/python` instead of `.venv/Scripts/python`.

* `download_models.py` fetches the identity models (about 80 MB, checksum-verified) into `backend/models/`.
* The first start also downloads the speech-to-text model (about 145 MB) and the interviewer voice (about 63 MB).
* Wait for `Application startup complete`.

Check it: open http://localhost:8000/api/health. You should see `"database": true`, `"identity": {"voice": true, "face": true}` and the coding languages your computer can run, for example `"coding_languages": ["python", "javascript", "cpp", "java"]`.

## 6. Configure and start the frontend

In a second terminal, from the repository folder:

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge, sign up with any email and password, and allow the camera and microphone. The default `.env` uses the team's Firebase project for sign-in; your interviews are stored only in your own database.

## 7. What to test

| Area | How |
| --- | --- |
| Rules and identity | Start Interview → the rules are read aloud → "I understand" → read the sentence for the identity check |
| Voice interview | Answer out loud; 3 seconds of silence moves on, or select Next |
| Coding round (VPL) | Keep "Include a coding round" ticked on Readiness: questions 2 and 4 open the code editor. Run the examples, then submit |
| Proctoring | Alt+Tab away and come back: warning. Stay away 5 seconds: the interview ends. 3 warnings also end it |
| Malpractice | Another person in view, a phone held up, someone else speaking, pasting text: each is a warning |
| Report | Integrity section, coding results, recording playback |
| Ranked Arena | Interview Arena → pick an area → play 6 levels → rating and rank; Leaderboard in the sidebar |

To test the ranking with more than one player, sign up a second account (another email) and play an Arena with it.

## 8. Running the tests

```bash
npm test
.venv/Scripts/python -m pytest backend
```

## 9. Troubleshooting

| Problem | Fix |
| --- | --- |
| `No module named 'google'` (or another module) | You started the backend with the system Python. Use `.venv/Scripts/python -m uvicorn …` |
| `"database": false` | PostgreSQL is not running, or `DATABASE_URL` has the wrong password, port or database name |
| `column … does not exist` | Run `schema.sql` again (step 3) |
| CORS error in the browser console | The frontend must run on http://localhost:5173 (or add your address to `CORS_ORIGINS` in `backend/.env`) |
| Camera or microphone not found | Allow them for localhost in the browser's site settings; close other apps that use the camera |
| "Virtual camera … not allowed" | Choose your real camera in the browser's site settings (OBS/virtual cameras are blocked) |
| Identity checks show `false` in health | Run `.venv/Scripts/python backend/download_models.py` again |
| C++ or Java missing in the editor | Install g++ / a JDK and make sure `g++` and `javac` work in a new terminal, then restart the backend |
| `faster-whisper` / `av` install fails | Use Python 3.12–3.14 from python.org and upgrade pip: `.venv/Scripts/python -m pip install -U pip` |
| Port 8000 already in use | Stop the other backend, or start this one with `--port 8001` and set `VITE_API_BASE_URL=http://localhost:8001` in `.env` |

## 10. Keeping up to date

```bash
git pull
.venv/Scripts/python -m pip install -r backend/requirements.txt
npm install
psql "postgresql://interview_app:choose-a-password@localhost:5432/interview_eval" -v ON_ERROR_STOP=1 -f schema.sql
```

Then restart the backend and the frontend.
