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
    name: "replay",
    description: "Analyze a Rocket League replay.",
    type: 1,
    options: [
      {
        type: 1,
        name: "analyze",
        description: "Calculate player stats, MVPR, OPI, DPI, and GPI from one replay.",
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
