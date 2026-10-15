# Jobsite Material Tracker

Phone-first app for jobsite material inventory: counts, daily production with takeoff ratios, waste and returns, POs and deliveries, reconciliation, and CSV reports. Works with no signal; entries sync when the connection returns.

- **App:** installable web app (PWA), hosted free on GitHub Pages.
- **Data and logins:** Firebase (Firestore + Authentication, email and password).
- **Access:** enforced by `firestore.rules` on the server.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, plus the Admin tab (people, invites, jobs, cleanup, audit, import, backup) |
| Foreman / PM | Set up jobs, takeoffs, production groups and POs; close jobs; all reports. Sees assigned jobs and jobs they create |
| Field counter | Counts, production, waste and deliveries on assigned jobs; can void only their own entries |
| Viewer | Read-only status, orders and reports on assigned jobs |

Entries are never silently deleted. Anyone allowed to correct an entry **voids** it; admins can restore or permanently purge voided entries in Admin › Cleanup.

## Adding people

1. Admin › Invites: enter their email, role and jobs.
2. Send them the app link. They tap **Create account** with that same email and confirm it from the email they receive.
3. Their role and jobs apply automatically. Change them later in Admin › People. To lock someone out, uncheck **Account active**.

## One-time setup

1. `src/config.js`: Firebase web config and `OWNER_EMAIL`.
2. `firestore.rules`: the same owner email in `ownerEmail()`.
3. Firebase console › Firestore Database › Rules: paste `firestore.rules` and **Publish**. Repeat whenever the rules file changes.
4. GitHub repo › Settings › Pages › Source: **GitHub Actions**.
5. Firebase console › Authentication › Settings › Authorized domains: add `<github-username>.github.io`.

Every push to `main` runs the security-rule tests (`tests/rules.test.mjs`) in the Firebase emulator, then builds and publishes the app. A failing rules test blocks the deploy.

## Local development

```
npm install
npm run dev          # app at http://localhost:5173
npm run test:rules   # needs Java 21
```
