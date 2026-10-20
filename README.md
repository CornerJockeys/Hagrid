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

`/ncp` is available to current franchise Captain+ staff. Captains are limited to their Discord-linked division; AGM/GM/FM staff can manage all configured-franchise divisions. A submission selects Doubles or Standard and exactly 2 or 3 current roster players respectively, then posts a **pending** request to the configured NCP thread. An AGM/GM/FM must approve or reject it there before it affects slot usage. Approved NCPs consume one series use for each selected slot. The flow also records whether the franchise or opponent was at fault and whether the NCP covered one game or the full five-game series. Season 20 NCP playoff credit is conditional: games may count toward the 15-game requirement when the franchise was not at fault. Hagrid stores that context now but does not automatically credit playoff-participation games until the player/game participation tracker is wired. `/ncpdummy` previews the same Captain+ flow without saving, posting, or changing usage. The future Season 20 matches/fixtures adapter will add the live match picker to this flow.

`/test dump` safely simulates the weekly **Eligibility**, **Salary**, or **Usage** output (or all three) in the configured Season 20 threads. The tester chooses a Match Week label from 1–10; every dump title includes that Match Week number. Usage posts to thread `1555478962187018271`, Salary to `1555478919811964928`, and Eligibility to `1555478866716262420`. This simulates the real weekly Discord output while leaving scheduled state unchanged. Production dumps run at **1:30 PM Eastern** on Mondays that begin a real Match Week, skip bye weeks, and are idempotent. Eligibility and Salary begin with Match Week 1 and stop after the Jan. 4 lock snapshot; Usage begins Nov. 2 (after Match Week 1 has produced real usage) and continues through the Jan. 18 Match Week 10 check.

The regular `/remind` command keeps its zero-option guided entry point. Reminder demos use the separate `/reminddummy` command, which opens the list of Player, Division, Team, Usage Division, and Usage Team previews. Each demo shows the example Discord output we expect from that reminder type without saving or pinging anyone.


### Season 20 roster, salary, and usage policy

Hagrid centralizes the current Season 20 rules instead of duplicating limits in commands and reports:

- **FL:** 4 active slots, Team Salary uses the top 4 salaries, cap **34.5**, usage **6 Doubles / 9 Standard / 15 combined**
- **AL:** 8 active slots, Team Salary uses the top 5 salaries, cap **62.5**, usage **6 / 8 / 12**
- **CL:** 8 active slots, Team Salary uses the top 5 salaries, cap **74.5**, usage **6 / 8 / 12**
- **ML:** 8 active slots, Team Salary uses the top 5 salaries, cap **86.5**, usage **6 / 8 / 12**
- **PL:** 4 active slots, Team Salary uses the top 4 salaries, cap **79.0**, usage **6 / 9 / 15**

Negative cap space is a normal numeric result and is displayed as a negative value rather than treated as an automatic roster violation. Salary-cap restrictions apply when active-roster transactions are made.

Season 20 operational cutoffs are also centralized: Eligibility/Salaries lock Jan. 4, 2027; Roster Lock is Jan. 11; proactive Usage checks continue through the Match Week 10 Monday on Jan. 18.

### Season 20 schedule and match-data dependencies

The official Season 20 schedule supplied to Hagrid is stored directly in the repo and drives the Activity **Schedule** tab. It contains all 10 Match Weeks, date windows, Division/Conference labels, home/away assignments, holiday bye periods, and the "Home Team Chooses Map" rule. Because this schedule is now a maintained local source, Hagrid does **not** need a live fixtures pull just to render the Schedule tab or resolve the basic Match Week calendar.

Sprocket's public schedule publications have distinct jobs:

- **fixtures** are the franchise-vs-franchise pairings. Each row has a `fixture_id`, `match_group_id`, home franchise, and away franchise.
- **match_groups** are the week containers. They provide the group ID, start/end dates, the week title, and the parent season/group.
- **matches** are the league + game-mode series underneath a fixture. They carry `match_id`, fixture/group IDs, scheduling window, scheduled time, home/away, league, game mode, series wins, and winner. They do **not** provide per-player game statistics.
- **player match stats / round participation** are therefore still required separately for individual game counts and official player performance.

The remaining shared match-data work should be built around the features that actually need it:

- **Playoff eligibility:** count the individual regular-season games a player actually participated in toward the 15-game requirement, including mid-series substitutions and the NCP exception rules. This requires player/game participation, not merely the `matches` table.
- **Official match stats:** the Activity Stats tab opens on Match stats by default, with a Scrims toggle. The Match view remains unavailable until the S20 per-game/player stat source exists.
- **NCP match picker:** use the real S20 match identity when available so an approved manual NCP can be attached to the exact league/game-mode series. The locally stored schedule can supply week/opponent/home-away context in the meantime.
- **Standings validation/result context:** Hagrid can continue using the published standings table for display; `matches` can later provide result-level validation and drill-down.
- **Usage and participation reconciliation:** where player/game participation is available, cross-check published slot usage against who actually played.
- **Weekly automation:** the locally stored schedule now provides the real Match Week/date calendar (including byes), so dump/checkpoint timing no longer needs to wait on live fixtures.

The Activity tab order is **Team Overview → Standings → Schedule → Stats → Scouting → League Rulebook → Broadcast Rulebook**. Team Overview contains its own **Overview / Eligibility / Availability** navigation, replacing the four former top-level personal/team eligibility and availability tabs.

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

The Activity verifies the Discord user and server, then links that Discord ID to the current franchise roster imported by Hagrid. Discord roles remain authoritative for staff permissions.

- **Players** can open Team Overview for their own divisional team, see teammates' eligibility and submitted availability, inspect an individual teammate's eligibility tracker, and edit only their own availability.
- **Captains** receive the same Team Overview and detailed Eligibility/Availability pages scoped to the division role they captain.
- **AGM/GM/FM staff** can view all FL/AL/CL/ML divisional teams in Team Overview and switch between them in the detailed pages.
- A user can never edit another player's availability; team visibility is read-only while the personal availability endpoint remains identity-bound.
- Non-playing staff can use team views without occupying a competitive roster slot. Personal availability editing is only shown when that Discord account has a linked roster identity.
- Users who are neither linked to the franchise nor authorized franchise staff receive a clear access error.

Staff-only/high-volume panels remain lazy-loaded so opening Hagrid does not trigger every backend request at startup.

### Team Overview

**Team Overview** is the Activity landing page for roster operations. The same UI adapts to the viewer's permissions instead of maintaining separate player, captain, and manager dashboards.

Each visible divisional card summarizes:

- current-week eligibility and how many players need attention,
- role usage once Season 20 usage reporting begins,
- Team Salary, salary cap, and plain numeric cap space (including negative values),
- current-week availability submissions and missing players.

The Team Salary calculation uses the centralized Season 20 rules: top four salaries for FL/PL and top five for AL/CL/ML. Negative cap space is displayed as a normal negative number rather than as an automatic violation.

The Team Overview sub-navigation is **Overview / Eligibility / Availability**.

### Eligibility

Eligibility combines the former personal and Team Eligibility views.

- players can see eligibility for the competitive players in their own divisional team,
- captains are scoped to the division(s) attached to their Captain role,
- AGM/GM/FM staff can view all configured franchise divisions,
- selecting a player opens the existing detailed scrim-point decay tracker,
- the detailed tracker still shows requirement, active points, Eligible Through, source freshness, and the weekly eligibility latch.

The backend enforces the viewer's team scope; the frontend cannot widen access by changing a query parameter.

### Availability

Availability combines the personal editor and team heatmap on one page.

The personal editor still uses the When2Meet-style grid:

- Monday through Sunday,
- **12:00 PM through 12:00 AM Eastern Time**,
- 1-hour display blocks by default with optional 30-minute blocks,
- drag or checkbox editing,
- previous/next week navigation,
- **Copy Previous Week**,
- explicit **Save Availability**.

Selections are stored at 30-minute resolution. Saving an empty week is a valid submission meaning unavailable for the whole scheduling window.

The team view uses those same submissions as a read-only scheduling heatmap.

- players see their own divisional team,
- captains see the team(s) they captain,
- AGM/GM/FM staff can view every franchise division,
- click a time block for Available / Unavailable / Missing,
- click a player for that player's submitted weekly ranges,
- missing submissions and unlinked Discord identities remain distinct,
- only competitive roster slots participate in overlap counts.

Players may view teammates' intentionally submitted team availability, but may only change their own submission.

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
3. compares that hash with the current Workers KV snapshot,
4. skips D1 current-snapshot writes entirely when the effective source is unchanged,
5. recalculates and replaces the live KV pool + HCPB snapshot when it changes,
6. writes only the compact once-per-day HCPB history to D1.

The legacy D1 current scouting tables remain as a fallback/bootstrap path, but production reads prefer KV. This keeps the hourly `:20` refresh cadence without rewriting the full current scouting dataset in D1 every time Sprocket changes.

## Live League Rulebook

The official Season 20 Google Doc is Hagrid's live League Rulebook source. Hagrid retains the bundled repository copy as a fallback.

Every five minutes the Worker:

1. fetches the public text export,
2. normalizes whitespace and equivalent numeric presentation such as `74.5` vs `74.50`,
3. compares it with the last accepted known-good version,
4. rejects suspicious snapshots that are empty, very small, or suddenly lose a large portion of the document,
5. when real content changed, posts **RULEBOOK CHANGE** with Before/After blocks in the configured Discord channel and pings the configured recipient,
6. updates the live KV copy and sync timestamp only after the notification succeeds.

The Activity shows **Last synced** and continues serving the last known-good copy if Google is unavailable or the watcher is paused.

GM/FM controls:

```text
/rulebookwatch status
/rulebookwatch pause
/rulebookwatch resume
```

Pausing freezes the current baseline: Hagrid does not accept source changes, update the Activity copy, archive a new version, or send change notifications. Resuming compares the current Google Doc against that frozen baseline on the next five-minute check, so multiple edits while paused become one consolidated change notification sequence.

Accepted versions are archived by the scheduled GitHub workflow. It writes dated PDF/text files under `resources/`, updates the current fallback text and bundled rulebook data, and tracks accepted hashes so the same version is not archived twice. Multiple accepted revisions on the same date receive a numeric suffix.

Rulebook changes **never automatically rewrite operational league rules** such as salary caps, usage limits, eligibility requirements, or deadlines. Those remain explicit, tested Hagrid policy and must be reviewed separately.

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

The franchise sync targets **Monday at 1:00 PM America/New_York**. Cloudflare cron is UTC, so Hagrid registers both possible UTC Monday times and verifies the actual Eastern clock before executing. This keeps the intended local time through daylight-saving changes. Weekly Match Week Eligibility/Salary/Usage posts run at **1:30 PM Eastern** after the sync and hourly `:20` league snapshot refresh; the local Season 20 schedule suppresses them during bye weeks.

The HCPB/pool snapshot uses a separate hourly cron at `20 * * * *`.

The live League Rulebook watcher uses a separate **five-minute** cron. It checks the public Google Doc, ignores formatting-only equivalents, keeps a last-known-good snapshot in KV/D1, and notifies the configured Discord channel only when accepted rulebook content changes.

## Architecture

Initial hosting target:

- **Cloudflare Workers** — Discord interactions, Activity API, dataset processing, replay analysis, scheduled tasks
- **Workers Static Assets** — built Activity frontend
- **Workers KV** — current derived scouting/pool snapshot and source hash used by the Activity and pool lookups
- **D1** — durable franchise state, history, configuration, availability, reminders, daily scouting history, and sync metadata
- **R2 (optional)** — source archives/replay retention if later needed
- **Cron Triggers** — Monday franchise sync + weekly dumps + hourly scouting/league refresh + five-minute rulebook watch

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
CLOUDFLARE_KV_NAMESPACE_ID   # workflow otherwise finds/creates a KV namespace named hagrid-cache
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

The remaining known data-dependent work is **official match results, official player match stats/participation, standings result validation/drill-down, and the real match-backed NCP picker** once MLE publishes the final Season 20 sources. Everything else remains subject to live deployment and user testing.

V1+ is intentionally held for Season 20 dataset/schema availability.

## Security

Never commit Discord tokens, Discord client secrets, Cloudflare credentials, GitHub tokens, or other secrets. Public identifiers can be deployment variables; credentials belong in the hosting platform's secret store.

## References

The replay-header implementation was informed by the open-source `nickbabcock/boxcars` parser. Sprocket's public datasets and rating implementation are upstream data/behavior references for the MLE-specific portions of Hagrid.
