# Hagrid

Hagrid is a Discord-first operations and analytics bot for a single Major League Esports (MLE) Rocket League franchise.

The bot is designed to consume public Sprocket/MLE datasets, track franchise-specific operational data, and give staff and players simple Discord commands for the information they actually need. It is not an official MLE service and is not intended to manage the league as a whole.

Hagrid is public so other franchises can adapt it. The target franchise is configured per Discord server rather than hard-coded.

## Planned capabilities

### Franchise configuration

- Set the franchise Hagrid should operate for from Discord.
- Store configuration per Discord server.
- Validate the requested franchise against Sprocket's public `teams` dataset before saving it.
- Store the canonical franchise name and code returned by Sprocket.
- Use the configured franchise to filter roster, usage, salary, eligibility, and related imports.

Current command shape:

```text
/franchise set name:Wizards
/franchise show
```

`/franchise set` accepts an exact franchise name or franchise code. If there is no exact match, Hagrid leaves the existing configuration unchanged and can show likely matches.

Changing the franchise is restricted to members with **Manage Server** permission.

### Weekly franchise sync

A scheduled Monday run, targeted for approximately **1:00 PM Eastern**, will refresh the franchise data that becomes available from MLE/Sprocket around that time.

The sync is planned to cover:

- roster/player assignments
- salary
- eligibility
- 2v2 / 3v3 / total role usage
- standings cache

The sync will be treated as a single versioned run. Production data is promoted only after the run validates successfully. Staff will also have a manual rerun command for failed imports.

Roster changes are expected behavior. A player joining, leaving, or moving into a different roster slot between weekly runs must be recorded as a change, not treated as a data-integrity failure.

### Standings

Standings will be available on demand in Discord. Hagrid may retain the surrounding current-season standings needed to show meaningful context, even though the bot itself operates only for one configured franchise.

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

The replay analyzer does not require Ballchasing or BakkesMod for normal completed replay files.

### Availability

Availability is an internal franchise tool only.

Hagrid will collect and summarize the configured franchise's player availability so staff can identify useful overlap. It will **not** attempt to ingest opponent availability, automatically negotiate match times, or schedule official MLE matches.

### Scouting

Later versions may port useful concepts from the existing MLE scouting sheets, particularly the HC Prospect Board, including items such as:

- OPI / DPI
- salary efficiency
- recent-form temperature
- Hot / Warm / Cold buckets
- role tendencies
- sample-size warnings
- prospect/player lookup

## Data sources

Hagrid consumes selected public datasets published by Sprocket. Current dataset access uses the public CSV publication path produced by the Sprocket datasets project:

```text
https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets/public/data
```

The base URL can be overridden with `SPROCKET_DATASET_BASE_URL`, which is useful for testing or if Sprocket changes the publication location.

Likely inputs include:

- `teams`
- `players`
- `role_usages`
- `eligibility_data`
- `standings`
- `all_the_ids`
- scrim/player statistics used for scouting

Trackmania datasets are intentionally out of scope. Hagrid is a Rocket League project.

## Architecture direction

The initial hosting target is Cloudflare:

- **Workers** — Discord interactions, dataset processing, replay analysis, and scheduled tasks
- **D1** — current franchise state, configuration, history, availability, and sync metadata
- **R2 (optional)** — raw source archives or replay retention if needed later
- **Cron Triggers** — scheduled weekly sync

The project should avoid mirroring the entire MLE database. Hagrid stores the configured franchise's operational state plus only the broader league context needed for features such as standings and scouting.

## Configuration model

Franchise configuration is per Discord guild.

At minimum Hagrid stores:

```text
guild_id
franchise_name
franchise_code
updated_by
updated_at
```

The franchise is resolved against Sprocket before it is written, so downstream imports can key off a canonical franchise identity rather than a free-text Discord value.

## Security

Never commit Discord tokens, Cloudflare credentials, or other secrets to this repository.

Expected deployment secrets include values such as:

```text
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
DISCORD_BOT_TOKEN
```

Public identifiers may be configured as ordinary deployment variables where appropriate, but credentials/tokens should use the hosting platform's secret store.

## Status

Early development. The initial Discord interaction endpoint, D1 franchise configuration, CSV dataset client, and Sprocket-backed franchise resolver are in place. Weekly sync, standings, replay analysis, availability, and scouting are still under active development.
