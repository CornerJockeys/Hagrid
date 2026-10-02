# Hagrid

Hagrid is a Discord-first operations and analytics app for a single Major League Esports (MLE) Rocket League franchise.

It combines normal Discord slash commands with a Discord Activity for workflows that need more UI than chat components can reasonably provide. Hagrid consumes selected public Sprocket/MLE datasets, tracks franchise-specific operational data, and exposes broader league context only where a feature needs it.

Hagrid is public so other franchises can adapt it. The target franchise is configured per Discord server rather than hard-coded to the Wizards.

## V1 scope

Hagrid V1 is intentionally limited to the data and workflows that can be built against the currently published Rocket League datasets:

- per-server franchise configuration
- weekly franchise roster / salary / eligibility / usage sync
- current standings lookup
- Rocket League replay analysis with MVPR / OPI / DPI / GPI
- player availability entry through the Hagrid Activity
- staff/team availability overview
- Scouting calculations and filtered Activity UI
- hourly Scouting refresh with source-change detection
- division-scoped FA/PEND pool lookup

Features that depend on Season 20-specific datasets or schemas are deferred to V1+ until those sources are published and can be validated rather than guessed.

## Discord commands

### Franchise configuration

```text
/franchise set name:Wizards
/franchise show
```

`/franchise set` requires **Manage Server**. The requested name/code is validated against Sprocket before Hagrid stores the canonical franchise configuration for that Discord server.

### Franchise data sync

```text
/sync run
/sync status
```

`/sync run` requires **Manage Server** and provides the manual rerun path for the same franchise pipeline used by the Monday scheduled refresh.

The franchise sync imports the configured franchise's Rocket League roster, slots, salaries, current scrim-point/eligibility fields, and current 2v2/3v3/total role usage. Roster movement is treated as normal effective-dated data rather than an integrity error.

### Player reminders

```text
/remind
/reminders list
/reminders cancel id:12
```

`/remind` is a guided Discord flow for the configured franchise. The Captain, AGM, GM, or FM first chooses **Player**, **Division**, **Team**, **Usage Division**, or **Usage Team**. Player reminders then select a division, player, target date, and cadence. Division reminders select a division and target date, then post the players who still need scrims for that date. Team reminders do the same eligibility calculation across all four divisions. Usage Division posts low-usage warnings for one division and pings that division's linked captain; Usage Team posts the same summary for every division. Usage warnings trigger below 3 remaining 2s uses, below 3 remaining 3s uses, or below 4 remaining uses overall, with combined exhaustion checked first so unusable mode leftovers are omitted. Normal is described in the picker as **every 2 days at 1:30 PM Eastern, plus the target date**. Daily sends at **1:30 PM Eastern** each day through the target date, and Once sends at **1:30 PM Eastern** on the target date only. The 30-minute delay leaves room for the 1:00 PM eligibility/roster pull to finish before reminders are evaluated. Players can use `/reminders list` to see reminders assigned to them, while creators can also cancel their own active reminders.

### NCP preview and dump tests

```text
/ncp
/test dump
```

`/ncp` is restricted to AGM/GM/FM staff and now goes directly into the live submission flow. `/ncpdummy` is the separate AGM+ demo command; it previews division → mode → match/slot effects without changing production NCP/usage state. Live NCP submission remains deferred until the Season 20 matches/fixtures adapter is wired, because NCPs must preserve slot usage while excluding those games from playoff eligibility.

`/test dump` safely simulates the weekly **Eligibility**, **Salary**, or **Usage** output (or all three) in the configured Season 20 threads. The tester chooses a Match Week label from 1–10; every dump title includes that Match Week number. Usage posts to thread `1555478962187018271`, Salary to `1555478919811964928`, and Eligibility to `1555478866716262420`. This simulates the real weekly Discord output while leaving scheduled state unchanged.

The regular `/remind` command keeps its zero-option guided entry point. Reminder demos use the separate `/reminddummy` command, which opens the list of Player, Division, Team, Usage Division, and Usage Team previews. Each demo shows the example Discord output we expect from that reminder type without saving or pinging anyone.

### Standings

```text
/standings
/standings mode:Doubles
/standings league:Champion League (CL)
/standings league:Champion League (CL) mode:Standard
```

Standings are fetched on demand. Without a league option Hagrid shows the configured franchise's current positions; choosing a league returns the relevant table and highlights the configured franchise.

### Replay analysis

```text
/replay analyze file:<match.replay>
```

Hagrid parses Rocket League replay-header `PlayerStats` and calculates goals, assists, saves, shots, MVPR, OPI, DPI, and GPI. Runtime parsing is dependency-free and does not require Ballchasing or BakkesMod.

The parser currently uses replay-header data rather than full network-frame decoding, so it warns when declared team size and header participant counts disagree.

### FA/PEND pool

```text
/pool division:CL
/pool division:CL status:FA
/pool division:CL status:PEND
```

`division` is deliberately required. Hagrid will not dump every division's player pool into one Discord response. Supported divisions are FL, AL, CL, ML, and PL.

When `status` is omitted the command includes both FA and PEND players, grouped by status. The pool snapshot is stored separately from HCPB stat rows so a player remains visible even when they do not yet have a usable scouting sample.

## Hagrid Activity

The Activity is the richer UI layer for features that do not fit cleanly into Discord messages, modals, buttons, or select menus. It is built with TypeScript, Vite, and Discord's Embedded App SDK and is served as static assets by the same Cloudflare Worker deployment.

### Activity access

The Activity verifies the Discord user and server, then links that Discord ID to the current franchise roster imported by Hagrid.

- **Current roster members** can use `My Availability` and their per-player `Eligibility` tracker.
- **Current franchise staff and captains** can additionally use `Team Availability` and the `Scouting`.
- Users who are in the Discord server but cannot be matched to the current franchise roster receive a clear roster-link error instead of being allowed to write availability under an untrusted identity.

Staff status is derived from the current franchise data (`Franchise Staff Position`), with a captain-slot fallback for compatibility. Staff-only panels are lazy-loaded so opening Hagrid solely to submit availability does not trigger unnecessary team/HCPB requests.

### My Availability

Availability is an internal franchise tool only. Hagrid does **not** ingest opponent availability, negotiate match times, or schedule official MLE matches.

The player workflow uses a When2Meet-style grid:

- Monday through Sunday
- **12:00 PM through 12:00 AM Eastern Time**
- 1-hour display blocks by default
- optional 30-minute display blocks
- drag-to-select editing
- optional checkbox editing
- previous/next week navigation
- **Copy Previous Week** into the current unsaved draft
- explicit **Save Availability** action

Selections are stored internally at 30-minute resolution even when the player uses the hourly view. Availability is stored compactly as one D1 row per player/week. Saving an empty week is still a real submission and means the player is unavailable for the entire window.

### Eligibility Tracker

The Activity includes a player-specific scrim eligibility view based on Sprocket's published `eligibility_data` event ledger and league eligibility requirements.

- shows active scrim-point decay from the Monday starting the current week through 30 days from today
- applies the published division-specific eligibility requirement rather than hard-coding one threshold
- treats scrim points as active through 30 days after the scrim, matching the MLE Evidence calculation
- applies the weekly rule from the Evidence view: reaching the requirement unlocks the rest of that week; if already eligible Monday, the full week remains locked through Sunday
- shows the current player feed's scrim points and `Eligible Through` value beside the independently calculated decay curve
- current players can view their own tracker; staff/captains can select any competitive player on the configured franchise

### Team Eligibility

Captain/AGM/GM/FM users have a **Team Eligibility** Activity view between the personal Eligibility and Availability tabs. It provides an all-roster or FL/AL/CL/ML overview with current-week eligibility, scrim points, requirement, Eligible Through, salary, and source-mismatch counts.

### Team Availability

The staff view uses the same underlying 30-minute data and presents it as a scheduling heatmap.

- filter by **FL / AL / CL / ML / PL** or view the full franchise
- switch between **1-hour** and **30-minute** heatmap cells
- hourly cells count a player only when that player is available for the entire hour
- click a time block to see **Available / Unavailable / Missing** players
- click a player to see that player's full weekly availability in readable time ranges
- show missing submissions separately
- distinguish a missing submission from an **unlinked Discord identity**
- show roster / submitted / missing / Discord-linked counts

Only competitive MLE roster spots (`PLAYERA`, `PLAYERB`, etc.) participate in team overlap counts. Franchise-only staff records are excluded so they cannot inflate the denominator or make a time window look worse than it actually is.

### Scouting

Hagrid ports the useful Scouting behavior into the backend and uses the Activity as the presentation layer. The HCPB Activity is staff/captain-only.

The main board is intentionally a first-glance performance/value table with exactly these columns:

```text
Name | Status | Salary | Games | Eff/Sal | Win% | Sprocket | OPI | DPI
```

Selecting a player opens the deeper detail view containing Temp, Bucket, Main Role, Alt Role, Score, Goals, Assists, Saves, Shots, SH%, Demos, sample flags, and role confidence.

The board can be filtered before results are returned by:

- player search
- FL / AL / CL / ML / PL
- 2v2 / 3v3 / combined mode
- Hot / Warm / Cold temperature bucket
- role
- minimum games
- salary min/max
- low-sample exclusion
- sort field
- 10 / 25 / 50 row limits

The UI never needs to render the entire prospect population at once.

#### HCPB calculations

The V1 calculation engine is based on the recovered S19 board behavior, but recovered formulas are treated as a starting point rather than something that must be preserved when a calculation is clearly misleading. Peer groups are league + mode and include current FA/PEND prospects with usable samples.

- **Eff/Sal:** builds an efficiency value from OPI/DPI (with the original fallbacks), divides by salary, then indexes the prospect against the peer group's mean so `50` represents peer-average value.
- **Temp:** compares the player's tracked per-game metrics with game-weighted peer averages using the original HCPB weights and caps.
- **Bucket:** Hot/Cold selections are limited to the top/bottom 15% of the peer group and must pass the original breadth checks; everyone else is Warm.
- **Roles:** Main/Alt role use the recovered 1st/2nd/3rd role formulas and confidence gap.
- **Flags:** a player is flagged for a low game sample below 9 games. The low-shot flag uses estimated **total shot opportunities**, not the per-game Shots value: fewer than 20 shots in 2s or fewer than 15 shots in 3s.

Regression tests use a known FL 2s HCPB sample and verify Eff/Sal, Temp, Bucket, Main/Alt Roles, sample flags, and shooting percentage, with dedicated boundary checks for 2s/3s shot-sample thresholds.

### Scouting refresh cadence

Sprocket's public dataset generation runs hourly. Hagrid schedules its scouting refresh for **`:20` past every hour** to leave time for the upstream build/CDN publication to finish.

Each refresh:

1. fetches the current FA/PEND identity/status source and current scouting stat source,
2. computes a stable source hash that also includes the HCPB algorithm version,
3. skips recalculation/D1 replacement if the effective source is unchanged,
4. recalculates and promotes the live pool + HCPB snapshot when it changes,
5. keeps a compact daily HCPB history rather than writing 24 historical copies every day.

## Data sources

Hagrid consumes selected public Sprocket datasets.

The working public CSV publication is currently:

```text
https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets
```

The Sprocket dataset repository also describes a namespaced `public/data` publication, but live validation on September 30, 2026 returned HTTP 403 for those CSV URLs while the root CSV publication succeeded. Hagrid therefore defaults to the working root publication and retains configurable primary/fallback base URLs.

Current adapters include:

- `teams` — franchise validation / canonical name and code
- `players` — configured-franchise roster, salary, slot, Discord identity, staff position, and eligibility-related fields
- `role_usages` — franchise role usage
- `standings` — on-demand standings
- `Avg_Scrim_Stats` — current HCPB scouting metrics

Live `Avg_Scrim_Stats` uses Sprocket mode codes `RL_DOUBLES` and `RL_STANDARD`; Hagrid normalizes those to 2s and 3s along with the human-readable aliases used by the older sheet tooling.

The bases can be overridden for development/testing:

```text
SPROCKET_DATASET_BASE_URL
SPROCKET_LEGACY_DATASET_BASE_URL
```

Trackmania datasets are intentionally out of scope. Hagrid is a Rocket League project.

## Scheduling

The franchise sync targets **Monday at 1:00 PM America/New_York**. Cloudflare cron is UTC, so Hagrid registers both possible UTC Monday times and verifies the actual Eastern clock before executing. This keeps the intended local time through daylight-saving changes.

The HCPB/pool snapshot uses a separate hourly cron at `20 * * * *`.

## Architecture

Initial hosting target:

- **Cloudflare Workers** — Discord interactions, Activity API, dataset processing, replay analysis, scheduled tasks
- **Workers Static Assets** — built Activity frontend
- **D1** — current franchise state, history, configuration, availability, scouting snapshots, pool snapshot, and sync metadata
- **R2 (optional)** — source archives/replay retention if later needed
- **Cron Triggers** — Monday franchise sync + hourly scouting refresh

Hagrid does not mirror the entire MLE database.

## Activity authentication

The Activity uses Discord's authorization-code flow through the Embedded App SDK. The browser receives a short-lived authorization code and sends it to Hagrid's Worker for exchange. Authenticated Activity API requests verify the Discord user and the guild from which the Activity was opened.

Never expose the Discord client secret to the Vite client.

## Production deployment

Hagrid includes a manual GitHub Actions workflow at `.github/workflows/deploy.yml`. It validates the build and live Sprocket sources before touching production, creates or reuses the `hagrid` D1 database, applies all migrations, builds/deploys the Worker and Activity, installs the Discord client secret, registers commands to a test guild, resolves the workers.dev URL, and runs deployed health/readiness checks.

### GitHub repository settings

Configure these **Actions secrets**:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN
```

Configure these **Actions variables**:

```text
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
DISCORD_GUILD_ID
```

Optional variables:

```text
CLOUDFLARE_D1_DATABASE_ID   # workflow otherwise finds/creates a DB named hagrid
HAGRID_BASE_URL             # workflow otherwise derives hagrid.<account>.workers.dev
HAGRID_SMOKE_FRANCHISE      # defaults to Wizards
```

For a completely new Cloudflare deployment, the API token must have permission to create/deploy the Worker and create/manage D1. Once those resources exist, the token can be narrowed if desired.

The deployment workflow deliberately registers commands to a **guild** during testing. It will not bulk-overwrite global commands when no test guild is supplied.

### Discord Developer Portal

Before launching the Activity in Discord:

1. Enable **Activities** for the Hagrid application.
2. Set the application's **Interactions Endpoint URL** to `https://<hagrid-host>/interactions`.
3. Add an Activity URL Mapping for `/` to the deployed Hagrid host.
4. Confirm the OAuth/application settings expose the Activity scopes used by Hagrid (`identify`, `applications.commands`, and `guilds.members.read`).
5. Invite/install the application in the test server if it is not there already.

The deploy workflow prints the resolved Hagrid workers.dev URL so the portal mapping can be filled in after the first deployment.

### Deployment health checks

Hagrid exposes:

```text
GET /health
GET /ready
```

`/health` confirms the Worker is running. `/ready` additionally verifies the required D1 tables and Discord Worker configuration are present. `npm run smoke:deployed` checks both plus the Activity root.

## Local development and testing

```text
npm install
npm run check
npm test
npm run build:activity
npm run dev
```

Validate the public Sprocket sources and Hagrid adapters without deploying:

```text
npm run smoke:live-sources
```

D1 migrations:

```text
npm run db:migrate:local
npm run db:migrate:remote
```

`wrangler.toml` intentionally contains a placeholder D1 database ID. Production deployment generates `.wrangler.deploy.toml` with the real D1 UUID so account-specific infrastructure IDs are not committed.

Register Discord commands locally:

```text
npm run register:commands
```

Set `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`. During testing, also set `DISCORD_GUILD_ID` so registration remains guild-scoped and updates immediately.

## V1 development status

Implemented through **Pass 3 wiring**:

- Cloudflare Worker Discord interaction endpoint
- Discord Ed25519 request verification
- D1-backed per-server franchise configuration/history
- Sprocket dataset clients/adapters
- weekly franchise current-state promotion + roster history
- manual sync/status commands
- Monday 1 PM Eastern scheduled sync
- standings command
- Rocket League replay parser + MVPR/OPI/DPI/GPI
- Discord Activity shell/authentication
- roster-backed Activity identity/access checks
- player availability grid, hourly/half-hour modes, drag/checkbox editing, copy previous week, save
- staff Team Availability heatmap with division filtering
- missing-submission and unlinked-Discord views
- time-block and per-player availability drilldowns
- staff/captain-only HCPB Activity access
- HCPB calculation engine
- HCPB filtered Activity table
- HCPB click-player detail view
- hourly HCPB refresh + source-change detection
- daily scouting history
- complete FA/PEND pool snapshot
- required-division `/pool` command
- replay, scouting, access, and availability regression tests
- automated live-source smoke validation
- production D1 provisioning/migrations
- production Worker/Activity deployment workflow
- deployed `/health` + `/ready` smoke validation

Live-source validation currently confirms the Wizards source path resolves a current six-player franchise roster with linked Discord IDs and competitive slots, plus current role usage, standings, FA/PEND identities, and 984 usable scouting rows.

The remaining V1 work is now primarily **live deployment and user testing**: configure the account/application credentials, run the deployment workflow, complete the Discord Activity URL mapping, then exercise each command and Activity workflow with real users.

V1+ is intentionally held for Season 20 dataset/schema availability.

## Security

Never commit Discord tokens, Discord client secrets, Cloudflare credentials, GitHub tokens, or other secrets. Public identifiers can be deployment variables; credentials belong in the hosting platform's secret store.

## References

The replay-header implementation was informed by the open-source `nickbabcock/boxcars` parser. Sprocket's public datasets and rating implementation are upstream data/behavior references for the MLE-specific portions of Hagrid.
