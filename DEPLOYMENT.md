# AInextleveler Deployment Guide

## Quick Deploy

```bash
git push origin main
```

Railway auto-deploys on push to `main`. Check status at: https://railway.app/project/[PROJECT_ID]

---

## Environment Variables

All env vars live in **Railway Service Variables** (not `.env`). Do NOT commit secrets to git.

### Required Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Railway PostgreSQL connection | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Shared: `~/.env.shared` | Claude API calls for assessment |
| `SESSION_SECRET` | Generated (32+ random chars) | iron-session encryption key |
| `AUTH_PASSWORD` | Set in Railway | Login password for the app |
| `GITHUB_TOKEN` | Shared: `~/.env.shared` | GitHub repo scanning (future: fork filtering) |

### How to Add/Update Variables

1. Go to Railway dashboard → AInextleveler project
2. Select the "ainextleveler" service
3. Click "Variables" tab
4. Add or edit the variable
5. Deploy will auto-trigger

### Shared vs App-Specific

- **Shared keys** (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) — live in `~/.env.shared` and are referenced in Railway, not duplicated
- **App-specific keys** (`SESSION_SECRET`, `AUTH_PASSWORD`, `DATABASE_URL`) — unique to this app, stored only in Railway

---

## Local Development

### First Time Setup

```bash
# 1. Clone and install
git clone https://github.com/teddycha/ainextleveler.git
cd ainextleveler

# 2. Load shared API keys
cp ~/.env.shared .env.local  # Optional: for local testing with real APIs

# 3. Start local PostgreSQL
npm run db:up

# 4. Push schema
npm run db:push

# 5. Run dev server
npm run dev
```

Open http://localhost:3000 and log in (default password from `.env`).

### Database

- **Local:** `docker compose up -d` starts Postgres on port 5433
- **Connection string:** `postgresql://postgres:postgres@localhost:5433/ainextleveler`
- **Stop:** `npm run db:down`

To inspect locally:
```bash
npm run db:studio  # Opens Drizzle Studio on http://localhost:5555
```

---

## Testing Before Deploy

Always test locally before pushing:

```bash
# Run tests
npm test

# Start dev server and manually test the feature
npm run dev

# Type-check before committing
npm run typecheck
```

**Critical flows to test:**
1. Add a resource via URL
2. Add a resource via pasted text
3. Trigger assessment (should detect duplicates)
4. Verify resource status changes to `inReview`

---

## Debugging Live Issues

### Check Logs

```bash
# View Railway logs (requires CLI)
railway logs

# Or in browser: Railway dashboard → Select service → Logs tab
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `Error: password authentication failed` | DATABASE_URL invalid or Postgres down | Check Railway PostgreSQL connection string in Variables |
| `Error: ANTHROPIC_API_KEY not found` | Env var not set in Railway | Add `ANTHROPIC_API_KEY` to Variables tab |
| `TypeError: Cannot read property 'url'` | Resource field missing | Check DB schema; run `npm run db:push` locally to verify |
| Assessment returns 500 | Haiku API failing | Check `ANTHROPIC_API_KEY` is set and API quota not exhausted |

### Enable Debug Logs

Edit `app/api/assess/route.ts` and add `console.log()` statements. Push to main. Logs appear in Railway dashboard → Logs tab.

---

## Rollback

If a deploy breaks production:

```bash
# View recent deployments
railway deployments

# Redeploy previous version
railway redeploy [DEPLOYMENT_ID]
```

Or in Railway dashboard: Deployments tab → select previous version → "Redeploy".

---

## Database Migrations

New schema changes?

```bash
# 1. Update lib/db/schema.ts locally
# 2. Generate migration
npm run db:generate

# 3. Test locally
npm run db:push

# 4. Push to main — Railway auto-runs migrations on deploy
git commit -am "db: add new column"
git push origin main
```

**Important:** Test migrations locally first. A failed migration in production is painful.

---

## Monitoring

### Key Metrics

- **Response time:** Check Railway dashboard → Metrics tab
- **Errors:** Railway Logs tab, filter by `ERROR` or `500`
- **Database:** Check Postgres metrics in Railway Postgres service

### Alerts

Currently: none configured. Consider adding:
- Deployment failures
- High error rates (>1% of requests)
- Database connection failures

---

## Deployment Workflow (Checklisted)

Before `git push origin main`:

- [ ] Tests pass locally: `npm test`
- [ ] Dev server works: `npm run dev` + manual test
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Schema changes tested locally: `npm run db:push`
- [ ] Commit message is clear and references what changed
- [ ] No `.env` secrets in git history

After push:

- [ ] Check Railway dashboard for successful deploy (green checkmark)
- [ ] Test live feature at https://ainextleveler.railway.app
- [ ] Check logs for any errors: `railway logs`
- [ ] If broken, rollback: `railway redeploy [PREVIOUS_ID]`

---

## Contact

For Railway support: https://railway.app/support
For app issues: Check logs → debug locally → test → re-deploy
