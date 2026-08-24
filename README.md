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

## Quick start

```bash
npm install
npx prisma migrate dev
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

Copy `.env` and adjust as needed:

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

## Repository access

- **Browse:** https://cursor.com/codebase/chris-don-wheelio/laptop-ordering
- **Visibility:** Private (changeable in settings on that page)

### Clone on Windows (via WSL)

The Origin CLI is not available in PowerShell — use WSL:

```bash
# Install the Origin CLI
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh

# Sign in (also sets up git credentials)
origin auth login

# Clone the repository
origin repo clone chris-don-wheelio/laptop-ordering
```

If `origin` is not found after install:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Origin CLI docs:** https://cursor.com/docs/origin/cli
