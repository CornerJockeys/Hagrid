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
- HC Prospect Board calculations and filtered Activity UI
- hourly HC Prospect Board refresh with source-change detection
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

The franchise sync currently imports the configured franchise's Rocket League roster, slots, salaries, current scrim-point/eligibility fields, and current 2v2/3v3/total role usage. Roster movement is treated as normal effective-dated data rather than an integrity error.

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

### Availability

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

Selections are stored internally at 30-minute resolution even when the player uses the hourly view. Availability is stored compactly as one D1 row per player/week.

### HC Prospect Board

Hagrid ports the existing HC Prospect Board behavior into the backend and uses the Activity only as the presentation layer.

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

The V1 calculation engine mirrors the recovered S19 board behavior. Peer groups are league + mode and include current FA/PEND prospects with usable samples.

- **Eff/Sal:** builds an efficiency value from OPI/DPI (with the original fallbacks), divides by salary, then indexes the prospect against the peer group's mean so `50` represents peer-average value.
- **Temp:** compares the player's tracked per-game metrics with game-weighted peer averages using the original HCPB weights and caps.
- **Bucket:** Hot/Cold selections are limited to the top/bottom 15% of the peer group and must pass the original breadth checks; everyone else is Warm.
- **Roles:** Main/Alt role use the recovered 1st/2nd/3rd role formulas and confidence gap.
- **Flags:** preserves the S19 low-games / low-shots board behavior.

Regression tests use a known FL 2s HCPB sample and verify Eff/Sal, Temp, Bucket, Main/Alt Roles, flags, and shooting percentage.

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

Current normal dataset base:

```text
https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets/public/data
```

Current adapters include:

- `teams` — franchise validation / canonical name and code
- `players` — configured-franchise roster, salary, slot, and eligibility-related fields
- `role_usages` — franchise role usage
- `standings` — on-demand standings
- `Avg_Scrim_Stats` — current HCPB scouting metrics

The HCPB/pool implementation also uses the legacy root `players.csv` publication as the current FA/PEND status authority because that source exposes the player-pool states used by the existing MLE tooling.

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

Activity build variable:

```text
VITE_DISCORD_CLIENT_ID=<Discord application ID>
```

Worker secrets/variables include:

```text
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
DISCORD_CLIENT_SECRET
```

The Discord Developer Portal still needs the deployed Activity URL mapping/configuration before the Activity can launch in Discord.

## Local development

```text
npm install
npm run check
npm run build:activity
npm run dev
```

D1 migrations:

```text
npm run db:migrate:local
npm run db:migrate:remote
```

`wrangler.toml` intentionally contains a placeholder D1 database ID until the production D1 database is created.

Register Discord commands:

```text
npm run register:commands
```

Set `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`. For faster development registration in one server, also set `DISCORD_GUILD_ID`.

## V1 development status

Implemented through Pass 1:

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
- player availability grid, hourly/half-hour modes, drag/checkbox editing, copy previous week, save
- HCPB calculation engine
- HCPB filtered Activity table
- HCPB click-player detail view
- hourly HCPB refresh + source-change detection
- daily scouting history
- complete FA/PEND pool snapshot
- required-division `/pool` command
- HCPB regression tests

Remaining before V1 moves primarily into testing:

- staff/team availability heatmap and missing-submission view
- staff permissions for staff-only Activity surfaces
- production Cloudflare/D1 deployment configuration
- Discord Developer Portal Activity URL mapping / launch configuration
- live-source schema/import smoke tests
- staff-channel scheduled-run notifications if retained for V1

V1+ is intentionally held for Season 20 dataset/schema availability.

## Security

Never commit Discord tokens, Discord client secrets, Cloudflare credentials, GitHub tokens, or other secrets. Public identifiers can be deployment variables; credentials belong in the hosting platform's secret store.

## References

The replay-header implementation was informed by the open-source `nickbabcock/boxcars` parser. Sprocket's public datasets and rating implementation are upstream data/behavior references for the MLE-specific portions of Hagrid.
