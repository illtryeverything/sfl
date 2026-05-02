# 🌻 SFL Yield Optimizer

Personal-use **Sunflower Land** companion app:

1. **Smart Farming Scheduler & Notifier** — polls your farm and sends Telegram alerts when crops are ready, animals need feeding, etc.
2. **Crafting Calculator** — given a target recipe, reads your real balances and tells you what you're missing (with optional "buy vs grow" hints from marketplace prices).

Built with Next.js 16 + TypeScript + SQLite + node-cron + Telegram Bot API. Single-process, designed for Railway.

---

## Quick start (local)

```powershell
# 1. Install
npm install

# 2. Configure
Copy-Item env.example.txt .env.local
# Edit .env.local and fill in:
#   SFL_API_KEY, SFL_FARM_ID
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# 3. Run (boots Next + scheduler in one process)
npm run dev
```

Open http://localhost:3000.

## Telegram setup

1. Open Telegram, talk to **@BotFather**, run `/newbot`, follow the prompts.
2. Copy the **bot token** into `TELEGRAM_BOT_TOKEN`.
3. Send any message to your bot.
4. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat.id` value.
5. Put that into `TELEGRAM_CHAT_ID`.
6. Hit **Send test** on the `/notifications` page to verify.

## Configuration reference

See `env.example.txt`. Key settings:

| Variable | Purpose |
| --- | --- |
| `SFL_API_BASE_URL` | `https://api.sunflower-land.com` (prod) or `https://api-dev.sunflower-land.com` (dev) |
| `SFL_API_KEY` | Your `x-api-key` from the Sunflower Land team |
| `SFL_FARM_ID` | Your in-game farm ID |
| `SFL_JWT` | Optional, only needed for Portal endpoints |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Bot credentials |
| `POLL_INTERVAL_MINUTES` | How often the scheduler polls (default 5) |
| `QUIET_HOURS_START` / `QUIET_HOURS_END` | Suppress notifications during these hours (24h) |
| `DATABASE_PATH` | SQLite file path. Use a Railway volume for persistence |

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Railway auto-detects the `Dockerfile` and builds.
4. Add a **Volume** mounted at `/app/data` and set `DATABASE_PATH=/app/data/sfl.db`. This keeps the SQLite file across deploys.
5. Set all env vars from `env.example.txt` under the service variables.
6. Deploy. The app exposes port `8080` (Railway maps automatically).

## How it works

```
┌──────────────────────────────┐
│ server.ts (single process)   │
│  ├─ Next.js HTTP handler     │  ← UI + API routes
│  └─ node-cron scheduler      │  ← polls SFL API every N minutes
│        │                     │
│        ├─ getFarmState()     │
│        ├─ detectEvents()     │
│        ├─ markNotifiedOnce() │  ← SQLite dedup
│        └─ sendTelegramMessage│
└──────────────────────────────┘
```

- `src/lib/sfl-client.ts` — multi-endpoint adapter for the Sunflower Land API (try several known paths, return first hit).
- `src/lib/farm-analyzer.ts` — pure functions: `FarmState → FarmEvent[]`. Easy to unit-test.
- `src/lib/scheduler.ts` — cron loop that ties polling, dedup, and notifications together.
- `src/lib/calculator.ts` — recipe / resource math.
- `src/lib/db.ts` — better-sqlite3 storage (rules, log, snapshot cache, dedup keys).

## Notes & caveats

- **API surface assumptions.** SFL's exact response shape varies by access tier and chapter. The client tries multiple endpoint paths and normalizes loosely. If your endpoints differ, edit `getRaw()` in `sfl-client.ts`.
- **Crop/animal cooldowns** are hardcoded (`CROP_SECONDS`, `ANIMAL_SECONDS`) for forwards-compatibility when the API only returns `plantedAt`. Buffs/skills that change these aren't accounted for — open an issue / PR if you want stat-aware times.
- **Recipe data** is illustrative — verify in-game before relying on the calculator for big purchases.
- **No automation of gameplay.** This tool only reads state and notifies; it does not click, plant, or trade. Safe under SFL's ToS.

## Roadmap ideas

- Marketplace price integration (auto-fill buy costs)
- Per-resource notification rules (e.g. "alert when I have ≥ 1000 Wood")
- Multi-farm support
- Push notifications via web (in addition to Telegram)
