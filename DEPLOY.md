# DEPLOY — Warrant

One Render web service, one URL. The console is built into static files and
served by the same FastAPI process that serves the API, so there is no CORS to
configure and nothing for a reviewer to find half-working.

```
  browser ──▶ https://warrant-demo.onrender.com
                      │
                      ├── /            console (built React, static)
                      ├── /assets/*    JS and CSS
                      ├── /api/*       the API
                      └── /healthz     Render's health check
```

---

## Before you push

Run the same gates the block plan uses. If any fail, fix them locally rather
than debugging inside a build log.

```bash
cd ~/AIAgents/warrant
source .venv/bin/activate
python -m pytest -q                    # 60 passed

cd console
npm run typecheck                      # silent
npm run test                           # 51 passed
npm run build                          # clean dist/
```

Then check the production shape works on your machine, exactly as the container
will run it:

```bash
cd ~/AIAgents/warrant
WARRANT_CONSOLE_DIR=$PWD/console/dist \
  uvicorn warrant.serve:app --app-dir src --port 8000
```

Open <http://localhost:8000>. This is the deployed layout — one port, no Vite.
Reload on `/ledger` to confirm deep links work.

---

## Push to GitHub

```bash
cd ~/AIAgents/warrant
git init
git add .
git commit -m "Warrant: delegated-authority agent platform"
git branch -M main
git remote add origin https://github.com/casktech-sys/warrant.git
git push -u origin main
```

`.gitignore` already excludes `.venv/`, `node_modules/`, `dist/` and
`__pycache__/`. Confirm before pushing:

```bash
git status --short | head -20
```

Nothing should list a virtualenv, a build output or a dependency folder.

---

## Create the Render service

Render reads `render.yaml`, so most of this is already decided.

1. Render dashboard → **New** → **Web Service**
2. Connect the GitHub repo
3. Render detects `render.yaml` and pre-fills:
   - Runtime **Docker**, Dockerfile at `./Dockerfile`
   - Health check `/healthz`
   - `WARRANT_ONLINE=0`, `WARRANT_MAX_SESSIONS=50`
4. Region: **Frankfurt** — closest of Render's regions to the Gulf, which
   matters for a demo someone opens from Dubai
5. Create

First build takes roughly 4–6 minutes: Node builds the console, then the Python
image installs three packages and copies the output in.

---

## What runs in production

**No API key, no model calls.** `WARRANT_ONLINE=0` selects the deterministic
offline provider. Every negotiation is reproducible, nothing leaves the
container, and there is no bill attached to the link.

**One worker.** State is in memory (block B5), so a second worker would serve a
different set of deals depending on which one a request landed on. The
Dockerfile pins `--workers 1` for that reason, not by accident.

**Fifty threads maximum.** The link is public and anyone can start a deal, so
the store evicts the oldest rather than refusing new ones. A demo that stops
working after fifty visitors is worse than one that forgets.

**Synthetic data only.** Nadia, Omar and the figures are invented. Nothing real
is in the container — which is itself part of what an AI governance reviewer is
assessing.

---

## Free tier, honestly

Render's free plan sleeps a service after 15 minutes idle. The first visit
after that takes 30–60 seconds to respond while it wakes.

That is fine for a link you send with context, and bad for a link someone clicks
cold during a call. If you are sending it to a client:

- Open it yourself five minutes beforehand to wake it, or
- Move to the paid Starter plan for the week you are interviewing

Restarting also clears every deal, since state is in memory. Say so in the
message rather than letting them discover it.

---

## What to send

Not a bare URL. Something like:

> Warrant — a demo of delegated authority for AI agents.
> **https://warrant-demo.onrender.com**
>
> A shipper and a haulier each write down what their agent may agree to, then
> the agents negotiate freight from Jebel Ali to Riyadh. When one wants to agree
> to something its owner never allowed, it stops before saying anything and
> asks.
>
> A walkthrough along the bottom tells you what to press. It takes about ninety
> seconds and you will be asked to decide twice.
>
> **Show technical detail** in the top right reveals the rule identifiers,
> authority chains and record hashes. Source: github.com/casktech-sys/warrant
>
> It sleeps when idle, so the first load may take a minute.

That paragraph does more work than the link. The walkthrough handles the rest —
it follows what the visitor actually does rather than assuming they take the
path you had in mind.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Build fails in stage 1 | `console/package-lock.json` missing or stale. Run `npm install` locally, commit the lockfile |
| Page loads, every panel empty | Open `/api/health` directly. If it 404s, the API is not mounted — check `warrant.serve:app` is the CMD target |
| 503 with "Console not built" | Stage 1 output did not copy. Check `WARRANT_CONSOLE_DIR` matches the `COPY --from=console` destination |
| Reloading `/ledger` gives 404 | The SPA fallback is not running. It is the last route in `serve.py` and must stay last |
| Deals vanish between visits | Expected. In-memory state, block B5 |
| Health check failing, service restarting | Render is hitting `/healthz`, not `/api/health`. Confirm in the dashboard |

---

## Local Docker, if you want to check the image first

```bash
cd ~/AIAgents/warrant
docker build -t warrant .
docker run --rm -p 8000:8000 warrant
```

Then <http://localhost:8000>. Same image Render builds.
