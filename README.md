# OvaBuy

**APAC hardware ordering — Client Services to Procurement**

OvaBuy is a proof-of-concept web app for managing HP laptop and peripheral orders across APAC offices. Client Services submits requests, Procurement approves and tracks them, and office budgets are deducted as orders progress.

## Features

- **Hardware catalog** — filter by category and brand; view cost and lead time (daily refresh limit)
- **CS order form** — line items, urgent flag, required date, business case, attachments, job/cost centre
- **Procurement workflow** — approve/reject, enter HP order numbers, import HP email updates
- **Order timeline** — full audit trail of status changes with comments
- **Budget tracking** — reserve on submit, commit on order placed, release on reject
- **Notifications** — in-app bell for CS and Procurement
- **Adapter stubs** — ready for HP API, shared mailbox, and ServiceNow when access is granted

## Launch Control (Windows)

Heimdall-style structure: thin **CMD** → hidden **PowerShell WinForms** UI + **Monitor** probes.

| File | Role |
|------|------|
| `scripts\OvaBuy-LaunchControl.cmd` | Master-facing entry (MLC scan / double-click) |
| `scripts\OvaBuy-LaunchControl.ps1` | WinForms UI: start/stop, redeploy, logs, follow tail |
| `scripts\OvaBuy-Redeploy.ps1` | Post-git-sync redeploy (install, migrate, build, restart; preserves `.env`) |
| `scripts\OvaBuy.Monitor.ps1` | Port/health probes (dot-sourced) |
| `scripts\launch-control.json` | Master Launch Control Generic sidecar |

**Logs:** `C:\OvaBuy\logs\` (repo-local; shared across profiles that run LC)
- `launch-control-{timestamp}.log` — session log
- `launch-control-live.log` — stable tail for MLC
- `dev-server.log` — npm run dev output

```bat
scripts\OvaBuy-LaunchControl.cmd
```

**Typical workflow after RepoSync / git pull:** open Launch Control, click **Redeploy (preserve config)**. That runs `npm install`, `db:deploy`, `next build`, and restarts the production server without touching `.env`.

**ActionOnly modes** (for automation / MLC):

```bat
scripts\OvaBuy-LaunchControl.cmd -ActionOnly -Mode Start
scripts\OvaBuy-LaunchControl.cmd -ActionOnly -Mode Stop
scripts\OvaBuy-LaunchControl.cmd -ActionOnly -Mode Redeploy
scripts\OvaBuy-LaunchControl.cmd -ActionOnly -Mode Setup
scripts\OvaBuy-LaunchControl.cmd -ActionOnly -Mode OpenLogs
```

**Health / version:** `GET http://127.0.0.1:43123/api/health` returns `version` and `productVersion` for Launch Control and Master Launch Control cards.

### Register in Master Launch Control

1. **Add app** → Display name: `OvaBuy`, Launch path: `...\OvaBuy\scripts\OvaBuy-LaunchControl.cmd`, Adapter: **Generic**
2. Or **Scan folder** on your OvaBuy directory
3. MLC **Open** → browser; **Open Launch Control** → WinForms UI; **Diagnostics** → flag file in logs folder

## Quick start (Windows PowerShell)

**Prerequisites:** [Node.js 20+](https://nodejs.org/) and [Git for Windows](https://git-scm.com/download/win)

```powershell
git clone https://github.com/uberslaw/OvaBuy.git
cd OvaBuy
copy .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://127.0.0.1:43123

> **Important:** Run `npm install` first and wait for it to finish. Do **not** use `npx prisma` directly — that downloads Prisma 7 which is incompatible. Always use `npm run db:migrate` which uses the project's Prisma 5.

### Troubleshooting Windows

| Error | Fix |
|-------|-----|
| `Could not read package.json` | Make sure you're inside the cloned `OvaBuy` folder (`dir` should show `package.json`) |
| `'next' is not recognized` | Run `npm install` first — dependencies aren't installed yet |
| Prisma `url is no longer supported` | You ran `npx prisma` instead of `npm run db:migrate`. Delete `node_modules`, run `npm install`, then `npm run db:migrate` |
| `'tsx' is not recognized` | Same as above — `npm install` didn't complete |

## Quick start (macOS / Linux)

```bash
git clone https://github.com/uberslaw/OvaBuy.git
cd OvaBuy
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123)

## Demo accounts

Password for all accounts: `demo123`

| Email | Role |
|-------|------|
| `cs.singapore@demo.local` | Client Services (Singapore) |
| `cs.sydney@demo.local` | Client Services (Sydney) |
| `procurement@demo.local` | Procurement |
| `admin@demo.local` | Admin |

## 5-minute demo script

1. **Login as CS (Singapore)** → Browse catalog → Create urgent order with attachment
2. **Login as Procurement** → See notification → Approve → Enter HP order number → Add comment
3. **Paste sample HP shipping email** on order detail → Timeline updates
4. **Login as CS** → See notifications → Mark partial then full delivery
5. **Login as Admin** → Show budget deducted → Show catalog refresh limit

### Sample HP email to paste

```
HP Order Number: HP-98765432
Your order OVB-2026-0001 has been shipped and is in transit.
Estimated delivery: 3-5 business days.
```

## Environment variables

Copy `.env.example` to `.env` and adjust as needed:

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="change-me-in-production"
NEXTAUTH_URL="http://127.0.0.1:43123"
```

Optional (future integrations):

```
HP_API_ENABLED=false
SERVICENOW_API_ENABLED=false
```

## Path to production APIs

| Integration | PoC today | Production |
|-------------|-----------|------------|
| HP catalog | Seed JSON refresh | `HP_API_ENABLED=true` → real HP portal API |
| HP order status | Paste/import email | IMAP/Graph API on shared mailbox |
| ServiceNow | Stub ticket logged | `SERVICENOW_API_ENABLED=true` → REST API |
| Notifications | In-app | + SMTP or AgentMail |

Adapters live in [`src/lib/adapters/`](src/lib/adapters/).

## Tech stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS + shadcn-style components
- Prisma + SQLite
- NextAuth (credentials provider)

## Repository

- **GitHub:** https://github.com/uberslaw/OvaBuy
