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
