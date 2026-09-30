# Hagrid

Hagrid is a Discord-first operations and analytics bot for a single Major League Esports (MLE) Rocket League franchise.

The bot consumes selected public Sprocket/MLE datasets, tracks franchise-specific operational data, and exposes the useful pieces through Discord. It is not an official MLE service and is not intended to manage the league as a whole.

Hagrid is public so other franchises can adapt it. The target franchise is configured per Discord server rather than hard-coded to the Wizards.

## Current commands

### Franchise configuration

```text
/franchise set name:Wizards
/franchise show
```

`/franchise set` requires **Manage Server**. The requested name or code is validated against Sprocket's public `teams` dataset before it is saved. Hagrid stores the canonical franchise name/code and leaves the existing configuration unchanged if validation fails.

### Franchise data sync

```text
/sync run
/sync status
```

`/sync run` requires **Manage Server** and runs the same franchise data pipeline used by the scheduled weekly refresh. The command is intended to provide a manual rerun path if an automatic import fails.

The current sync imports:

- Rocket League players for the configured franchise
- roster slot assignments
- salary
- current scrim points / eligibility-through data exposed by `players`
- current 2v2 / 3v3 / total role usage

Each run receives a unique run ID and is logged as `RUNNING`, `SUCCESS`, or `FAILED`. Current franchise data is only replaced after the source data has been fetched and validated. D1 promotion uses a batch so a failed promotion does not intentionally leave a half-updated current state.

Only one sync can be `RUNNING` for a Discord server at a time. A run left stuck for more than 30 minutes is marked failed before a replacement run is allowed.

Roster movement is normal data, not an integrity error. Hagrid logs joins, departures, slot changes, salary changes, eligibility changes, scrim-point changes, and display-name changes. Slot assignments are kept as effective history rather than rewriting the past when a player joins or leaves the team.

### Standings

```text
/standings
/standings mode:Doubles
/standings league:Champion League (CL)
/standings league:Champion League (CL) mode:Standard
```

Standings are fetched on demand from Sprocket rather than being tied to the Monday batch.

Without a league option, Hagrid shows the configured franchise's current position and record in FL, AL, CL, and ML. Supplying a league shows the complete relevant division/conference table and highlights the configured franchise.

Modes are:

- Overall
- Doubles
- Standard

### Replay analysis

```text
/replay analyze file:<match.replay>
```

Hagrid can parse the header of a normal Rocket League `.replay` attachment and calculate per-player:

- goals
- assists
- saves
- shots
- MVPR
- OPI
- DPI
- GPI

The command is intentionally dependency-free at runtime: it does not require Ballchasing or BakkesMod. It validates the attachment type/size, only downloads Discord attachment URLs, caps replay uploads at 15 MiB, and includes a short SHA-256 fingerprint in the response.

The parser currently uses replay-header `PlayerStats`, not full network-frame decoding. Rocket League replay headers can omit players who join or drop during a match, so Hagrid warns when the declared team size and header player counts disagree. Full network parsing remains a later hardening option for competitive submission workflows.

MVPR uses the legacy formula recovered from the old MVPR plugin. OPI/DPI use the current Sprocket rating implementation previously identified in Sprocket's public code, with separate 2s and 3s constants. GPI is the mean of OPI and DPI.

## Scheduled weekly sync

Hagrid targets **Monday at 1:00 PM America/New_York** for the automated franchise refresh.

Cloudflare cron expressions are UTC, so the Worker is configured for both 17:00 and 18:00 UTC on Mondays. The scheduled handler checks the actual `America/New_York` local time and only executes when it is 1:00 PM Eastern. This keeps the intended local time through daylight-saving changes.

The automatic and manual sync paths call the same underlying sync service.

## Planned capabilities

### Availability

Availability is an internal franchise tool only.

Hagrid will collect and summarize the configured franchise's player availability so staff can identify useful overlap. It will **not** ingest opponent availability, negotiate match times, or schedule official MLE matches.

### Scouting

Later versions may port useful concepts from the existing MLE scouting sheets, particularly the HC Prospect Board, including:

- OPI / DPI
- salary efficiency
- recent-form temperature
- Hot / Warm / Cold buckets
- role tendencies
- sample-size warnings
- prospect/player lookup

## Data sources

Hagrid consumes selected public datasets published by Sprocket. Dataset access currently targets the CSV publication path produced by the Sprocket datasets project:

```text
https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets/public/data
```

The base URL can be overridden with `SPROCKET_DATASET_BASE_URL` for development/testing or if the publication location changes.

Current adapters exist for:

- `teams` — franchise validation and canonical name/code
- `players` — current franchise Rocket League roster, salary, slot and eligibility-related fields
- `role_usages` — franchise role usage by season/league/slot
- `standings` — on-demand current-season standings

Likely future inputs include:

- `eligibility_data` for deeper eligibility auditing if needed
- `all_the_ids` for additional identity reconciliation
- scrim/player statistics used for scouting

Trackmania datasets are intentionally out of scope. Hagrid is a Rocket League project.

## Architecture

The initial hosting target is Cloudflare:

- **Workers** — Discord interactions, dataset processing, replay analysis, and scheduled tasks
- **D1** — current franchise state, roster history, configuration, change history, and sync metadata
- **R2 (optional)** — raw source archives or replay retention if needed later
- **Cron Triggers** — scheduled Monday refresh

Hagrid does not mirror the entire MLE database. It stores the configured franchise's operational state plus broader league context only when a feature requires it. For example, standings are currently read on demand instead of copied wholesale into D1.

## Database migrations

Apply D1 migrations locally with:

```text
npm run db:migrate:local
```

Apply them to the configured remote D1 database with:

```text
npm run db:migrate:remote
```

`wrangler.toml` intentionally contains a placeholder D1 database ID until the deployment database is created.

## Discord command registration

Set the application ID and bot token in your local environment, then run:

```text
npm run register:commands
```

For faster development registration in one server, also set `DISCORD_GUILD_ID`. Without it, commands are registered globally.

The Discord token is only needed by the command-registration script. The Worker interaction endpoint validates Discord requests with `DISCORD_PUBLIC_KEY`.

## Security

Never commit Discord tokens, Cloudflare credentials, GitHub tokens, or other secrets to this repository.

Expected deployment/local secrets include values such as:

```text
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
DISCORD_BOT_TOKEN
```

Public identifiers can be ordinary deployment variables where appropriate; credentials and tokens belong in the hosting platform's secret store.

## Development status

Implemented foundation:

- Cloudflare Worker Discord interaction endpoint
- Discord Ed25519 request verification
- D1-backed per-server franchise configuration and audit history
- Sprocket CSV client
- Sprocket-backed franchise resolution
- current Rocket League franchise-player adapter
- role-usage adapter
- atomic current-state promotion with roster/change history
- manual sync and sync-status commands
- overlapping/stale sync protection
- Monday 1 PM Eastern scheduled sync trigger
- on-demand standings command
- Rocket League replay-header parser
- MVPR / OPI / DPI / GPI calculations
- `/replay analyze` Discord workflow
- GitHub Actions TypeScript CI

Not yet implemented:

- production Cloudflare/D1 deployment configuration
- live end-to-end replay validation inside the deployed Worker
- availability workflows
- scouting/prospect commands
- staff-channel scheduled-run notifications
- deeper identity/eligibility adapters
- network-frame replay parsing for join/drop edge cases

The codebase is still early development. Dataset schemas and deployment behavior should be validated against live Sprocket output before Hagrid is treated as production-critical.

## References

The replay header format implementation was informed by the open-source `nickbabcock/boxcars` Rocket League replay parser. Hagrid only parses the small header subset it currently needs rather than implementing Boxcars' full network decoder.

Sprocket's public datasets and rating implementation are upstream data/behavior references for the MLE-specific portions of Hagrid.
