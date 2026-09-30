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

## Scheduled weekly sync

Hagrid targets **Monday at 1:00 PM America/New_York** for the automated franchise refresh.

Cloudflare cron expressions are UTC, so the Worker is configured for both 17:00 and 18:00 UTC on Mondays. The scheduled handler checks the actual `America/New_York` local time and only executes when it is 1:00 PM Eastern. This keeps the intended local time through daylight-saving changes.

The automatic and manual sync paths call the same underlying sync service.

## Planned capabilities

### Replay analysis

Hagrid will support direct analysis of standard Rocket League `.replay` files submitted through Discord.

Planned output includes:

- goals
- assists
- saves
- shots
- MVPR
- OPI
- DPI
- GPI

The existing prototype can obtain these values from normal completed replay headers without Ballchasing or BakkesMod. That parser still needs to be ported into Hagrid.

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
- Monday 1 PM Eastern scheduled sync trigger
- on-demand standings command
- GitHub Actions TypeScript CI

Not yet implemented:

- production Cloudflare/D1 deployment configuration
- replay command/parser port
- availability workflows
- scouting/prospect commands
- staff-channel scheduled-run notifications
- deeper identity/eligibility adapters

The codebase is still early development. Dataset schemas and deployment behavior should be validated against live Sprocket output before Hagrid is treated as production-critical.
