const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken) {
  console.error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required.");
  process.exit(1);
}

const commands = [
  {
    name: "franchise",
    description: "View or configure the franchise Hagrid operates for.",
    type: 1,
    options: [
      {
        type: 1,
        name: "set",
        description: "Set the franchise for this Discord server.",
        options: [
          {
            type: 3,
            name: "name",
            description: "Franchise name or code, for example Wizards.",
            required: true,
            min_length: 2,
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "show",
        description: "Show the franchise configured for this Discord server.",
      },
    ],
  },
  {
    name: "fa",
    description: "Show free-agent and pending players for one division.",
    type: 1,
    options: [
      {
        type: 3,
        name: "division",
        description: "Division to show. A division is always required.",
        required: true,
        choices: [
          {name: "Foundation League (FL)", value: "FL"},
          {name: "Academy League (AL)", value: "AL"},
          {name: "Champion League (CL)", value: "CL"},
          {name: "Master League (ML)", value: "ML"},
          {name: "Premier League (PL)", value: "PL"},
        ],
      },
      {
        type: 3,
        name: "status",
        description: "Show free agents, pending players, or both.",
        required: false,
        choices: [
          {name: "Both (FA + PEND)", value: "BOTH"},
          {name: "Free Agents (FA)", value: "FA"},
          {name: "Pending (PEND)", value: "PEND"},
        ],
      },
      {
        type: 10,
        name: "salary",
        description: "Optionally show only players with this exact salary.",
        required: false,
        min_value: 0,
        max_value: 100,
      },
    ],
  },
  {
    name: "team",
    description: "Show a league franchise roster with salary, eligibility, and usage.",
    type: 1,
    options: [
      {
        type: 3,
        name: "team",
        description: "Franchise to look up.",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "division",
        description: "Optionally show one divisional team only.",
        required: false,
        choices: [
          {name: "Foundation League (FL)", value: "FL"},
          {name: "Academy League (AL)", value: "AL"},
          {name: "Champion League (CL)", value: "CL"},
          {name: "Master League (ML)", value: "ML"},
        ],
      },
      {
        type: 5,
        name: "scrims",
        description: "Include compact 2s/3s scrim performance stats (use with division).",
        required: false,
      },
    ],
  },
  {
    name: "ncp",
    description: "Submit or preview a franchise NCP workflow (AGM+ only).",
    type: 1,
  },
  {
    name: "player",
    description: "Show a league player profile and S20 game or scrim stats.",
    type: 1,
    options: [
      {
        type: 3,
        name: "player",
        description: "Player to look up.",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "stats",
        description: "Choose official game stats or scrim stats.",
        required: true,
        choices: [
          {name: "Game", value: "Game"},
          {name: "Scrim", value: "Scrim"},
        ],
      },
      {
        type: 3,
        name: "mode",
        description: "Show 2s, 3s, or both modes.",
        required: false,
        choices: [
          {name: "Both", value: "Both"},
          {name: "2s", value: "2s"},
          {name: "3s", value: "3s"},
        ],
      },
    ],
  },
  {
    name: "remind",
    description: "Create a guided reminder for a franchise player.",
    type: 1,
  },
  {
    name: "reminders",
    description: "View or cancel active scrim reminders.",
    type: 1,
    options: [
      {
        type: 1,
        name: "list",
        description: "Show active reminders assigned to you or created by you.",
      },
      {
        type: 1,
        name: "cancel",
        description: "Cancel an active reminder you created.",
        options: [
          {
            type: 4,
            name: "id",
            description: "Reminder ID shown by /reminders list.",
            required: true,
            min_value: 1,
          },
        ],
      },
    ],
  },
  {
    name: "replay",
    description: "Analyze a Rocket League replay.",
    type: 1,
    options: [
      {
        type: 1,
        name: "analyze",
        description: "Calculate player stats, SR, OPI, and DPI from one replay.",
        options: [
          {
            type: 11,
            name: "file",
            description: "Rocket League .replay file.",
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "standings",
    description: "Show current standings for the configured franchise.",
    type: 1,
    options: [
      {
        type: 3,
        name: "league",
        description: "Show the full relevant division table for one league.",
        required: false,
        choices: [
          {name: "Foundation League (FL)", value: "Foundation League"},
          {name: "Academy League (AL)", value: "Academy League"},
          {name: "Champion League (CL)", value: "Champion League"},
          {name: "Master League (ML)", value: "Master League"},
        ],
      },
      {
        type: 3,
        name: "mode",
        description: "Overall, Doubles, or Standard standings.",
        required: false,
        choices: [
          {name: "Overall", value: "Overall"},
          {name: "Doubles", value: "Doubles"},
          {name: "Standard", value: "Standard"},
        ],
      },
    ],
  },
  {
    name: "test",
    description: "Run safe Hagrid feature simulations.",
    type: 1,
    options: [
      {
        type: 1,
        name: "dump",
        description: "Simulate a weekly eligibility, salary, or usage dump in this channel.",
      },
    ],
  },
  {
    name: "sync",
    description: "Run or inspect Hagrid's franchise data sync.",
    type: 1,
    options: [
      {
        type: 1,
        name: "run",
        description: "Run the franchise data sync now.",
      },
      {
        type: 1,
        name: "status",
        description: "Show the latest franchise data sync status.",
      },
    ],
  },
];

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Discord command registration failed (${response.status}):`);
  console.error(body);
  process.exit(1);
}

console.log(
  `Registered ${commands.length} command(s) ${guildId ? `for guild ${guildId}` : "globally"}.`,
);

// PRIMARY_ENTRY_POINT commands cannot be guild-scoped. Register one globally so the
// App Launcher has a real Launch action for Hagrid's Discord Activity.
const launchResponse = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
  {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "launch",
      description: "Launch the Hagrid Activity.",
      type: 4,
      handler: 2,
    }),
  },
);

const launchBody = await launchResponse.text();
if (!launchResponse.ok) {
  console.error(`Discord Activity launch registration failed (${launchResponse.status}):`);
  console.error(launchBody);
  process.exit(1);
}

console.log("Registered Hagrid's global Activity launch entry point.");
