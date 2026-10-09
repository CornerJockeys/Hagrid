export type S20MatchKind = "Division" | "Conference";

export interface S20ScheduleMatchup {
  away: string;
  home: string;
}

export interface S20ScheduleWeek {
  matchWeek: number;
  label: string;
  startDate: string;
  endDate: string;
  kind: S20MatchKind;
  homeChoosesMap: true;
  matchups: S20ScheduleMatchup[];
}

export interface S20ScheduleBye {
  label: string;
  afterMatchWeek: number;
}

export const S20_SCHEDULE_WEEKS: S20ScheduleWeek[] = [
  {
    matchWeek: 1, label: "Oct 29 - Nov 1", startDate: "2026-10-29", endDate: "2026-11-01",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Puffins",home:"Sabres"},{away:"Foxes",home:"Tyrants"},{away:"Eclipse",home:"Spectre"},{away:"Comets",home:"Wizards"},
      {away:"Hive",home:"Hurricanes"},{away:"Aviators",home:"Jets"},{away:"Lightning",home:"Shadow"},{away:"Blizzard",home:"Wolves"},
      {away:"Hawks",home:"Pirates"},{away:"Ducks",home:"Sharks"},{away:"Dodgers",home:"Elite"},{away:"Demolition",home:"Flames"},
      {away:"Knights",home:"Outlaws"},{away:"Express",home:"Spartans"},{away:"Bulls",home:"Pandas"},{away:"Bears",home:"Rhinos"},
    ],
  },
  {
    matchWeek: 2, label: "Nov 5 - Nov 8", startDate: "2026-11-05", endDate: "2026-11-08",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Foxes",home:"Puffins"},{away:"Tyrants",home:"Sabres"},{away:"Comets",home:"Eclipse"},{away:"Wizards",home:"Spectre"},
      {away:"Aviators",home:"Hive"},{away:"Jets",home:"Hurricanes"},{away:"Blizzard",home:"Lightning"},{away:"Wolves",home:"Shadow"},
      {away:"Ducks",home:"Hawks"},{away:"Sharks",home:"Pirates"},{away:"Demolition",home:"Dodgers"},{away:"Flames",home:"Elite"},
      {away:"Express",home:"Knights"},{away:"Spartans",home:"Outlaws"},{away:"Bears",home:"Bulls"},{away:"Rhinos",home:"Pandas"},
    ],
  },
  {
    matchWeek: 3, label: "Nov 12 - Nov 15", startDate: "2026-11-12", endDate: "2026-11-15",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Sabres",home:"Foxes"},{away:"Puffins",home:"Tyrants"},{away:"Spectre",home:"Comets"},{away:"Eclipse",home:"Wizards"},
      {away:"Hurricanes",home:"Aviators"},{away:"Hive",home:"Jets"},{away:"Shadow",home:"Blizzard"},{away:"Lightning",home:"Wolves"},
      {away:"Pirates",home:"Ducks"},{away:"Hawks",home:"Sharks"},{away:"Elite",home:"Demolition"},{away:"Dodgers",home:"Flames"},
      {away:"Outlaws",home:"Express"},{away:"Knights",home:"Spartans"},{away:"Pandas",home:"Bears"},{away:"Bulls",home:"Rhinos"},
    ],
  },
  {
    matchWeek: 4, label: "Nov 19 - Nov 22", startDate: "2026-11-19", endDate: "2026-11-22",
    kind: "Conference", homeChoosesMap: true,
    matchups: [
      {away:"Jets",home:"Blizzard"},{away:"Aviators",home:"Lightning"},{away:"Hive",home:"Shadow"},{away:"Hurricanes",home:"Wolves"},
      {away:"Tyrants",home:"Comets"},{away:"Foxes",home:"Eclipse"},{away:"Puffins",home:"Spectre"},{away:"Sabres",home:"Wizards"},
      {away:"Spartans",home:"Bears"},{away:"Express",home:"Bulls"},{away:"Knights",home:"Pandas"},{away:"Outlaws",home:"Rhinos"},
      {away:"Sharks",home:"Demolition"},{away:"Ducks",home:"Dodgers"},{away:"Hawks",home:"Elite"},{away:"Pirates",home:"Flames"},
    ],
  },
  {
    matchWeek: 5, label: "Dec 3 - Dec 6", startDate: "2026-12-03", endDate: "2026-12-06",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Puffins",home:"Foxes"},{away:"Sabres",home:"Tyrants"},{away:"Eclipse",home:"Comets"},{away:"Spectre",home:"Wizards"},
      {away:"Hive",home:"Aviators"},{away:"Hurricanes",home:"Jets"},{away:"Lightning",home:"Blizzard"},{away:"Shadow",home:"Wolves"},
      {away:"Hawks",home:"Ducks"},{away:"Pirates",home:"Sharks"},{away:"Dodgers",home:"Demolition"},{away:"Elite",home:"Flames"},
      {away:"Knights",home:"Express"},{away:"Outlaws",home:"Spartans"},{away:"Bulls",home:"Bears"},{away:"Pandas",home:"Rhinos"},
    ],
  },
  {
    matchWeek: 6, label: "Dec 10 - Dec 13", startDate: "2026-12-10", endDate: "2026-12-13",
    kind: "Conference", homeChoosesMap: true,
    matchups: [
      {away:"Blizzard",home:"Aviators"},{away:"Lightning",home:"Hive"},{away:"Shadow",home:"Hurricanes"},{away:"Wolves",home:"Jets"},
      {away:"Comets",home:"Foxes"},{away:"Eclipse",home:"Puffins"},{away:"Spectre",home:"Sabres"},{away:"Wizards",home:"Tyrants"},
      {away:"Bears",home:"Express"},{away:"Bulls",home:"Knights"},{away:"Pandas",home:"Outlaws"},{away:"Rhinos",home:"Spartans"},
      {away:"Demolition",home:"Ducks"},{away:"Dodgers",home:"Hawks"},{away:"Elite",home:"Pirates"},{away:"Flames",home:"Sharks"},
    ],
  },
  {
    matchWeek: 7, label: "Dec 17 - Dec 20", startDate: "2026-12-17", endDate: "2026-12-20",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Tyrants",home:"Foxes"},{away:"Sabres",home:"Puffins"},{away:"Wizards",home:"Comets"},{away:"Spectre",home:"Eclipse"},
      {away:"Jets",home:"Aviators"},{away:"Hurricanes",home:"Hive"},{away:"Wolves",home:"Blizzard"},{away:"Shadow",home:"Lightning"},
      {away:"Sharks",home:"Ducks"},{away:"Pirates",home:"Hawks"},{away:"Flames",home:"Demolition"},{away:"Elite",home:"Dodgers"},
      {away:"Spartans",home:"Express"},{away:"Outlaws",home:"Knights"},{away:"Rhinos",home:"Bears"},{away:"Pandas",home:"Bulls"},
    ],
  },
  {
    matchWeek: 8, label: "Jan 5 - Jan 10", startDate: "2027-01-05", endDate: "2027-01-10",
    kind: "Conference", homeChoosesMap: true,
    matchups: [
      {away:"Hive",home:"Blizzard"},{away:"Hurricanes",home:"Lightning"},{away:"Jets",home:"Shadow"},{away:"Aviators",home:"Wolves"},
      {away:"Puffins",home:"Comets"},{away:"Sabres",home:"Eclipse"},{away:"Tyrants",home:"Spectre"},{away:"Foxes",home:"Wizards"},
      {away:"Knights",home:"Bears"},{away:"Outlaws",home:"Bulls"},{away:"Spartans",home:"Pandas"},{away:"Express",home:"Rhinos"},
      {away:"Hawks",home:"Demolition"},{away:"Pirates",home:"Dodgers"},{away:"Sharks",home:"Elite"},{away:"Ducks",home:"Flames"},
    ],
  },
  {
    matchWeek: 9, label: "Jan 12 - Jan 17", startDate: "2027-01-12", endDate: "2027-01-17",
    kind: "Division", homeChoosesMap: true,
    matchups: [
      {away:"Tyrants",home:"Puffins"},{away:"Foxes",home:"Sabres"},{away:"Wizards",home:"Eclipse"},{away:"Comets",home:"Spectre"},
      {away:"Jets",home:"Hive"},{away:"Aviators",home:"Hurricanes"},{away:"Wolves",home:"Lightning"},{away:"Blizzard",home:"Shadow"},
      {away:"Sharks",home:"Hawks"},{away:"Ducks",home:"Pirates"},{away:"Flames",home:"Dodgers"},{away:"Demolition",home:"Elite"},
      {away:"Spartans",home:"Knights"},{away:"Express",home:"Outlaws"},{away:"Rhinos",home:"Bulls"},{away:"Bears",home:"Pandas"},
    ],
  },
  {
    matchWeek: 10, label: "Jan 19 - Jan 24", startDate: "2027-01-19", endDate: "2027-01-24",
    kind: "Conference", homeChoosesMap: true,
    matchups: [
      {away:"Shadow",home:"Aviators"},{away:"Wolves",home:"Hive"},{away:"Blizzard",home:"Hurricanes"},{away:"Lightning",home:"Jets"},
      {away:"Spectre",home:"Foxes"},{away:"Wizards",home:"Puffins"},{away:"Comets",home:"Sabres"},{away:"Eclipse",home:"Tyrants"},
      {away:"Pandas",home:"Express"},{away:"Rhinos",home:"Knights"},{away:"Bears",home:"Outlaws"},{away:"Bulls",home:"Spartans"},
      {away:"Elite",home:"Ducks"},{away:"Flames",home:"Hawks"},{away:"Demolition",home:"Pirates"},{away:"Dodgers",home:"Sharks"},
    ],
  },
];

export const S20_SCHEDULE_BYES: S20ScheduleBye[] = [
  {label: "Thanksgiving Bye Week", afterMatchWeek: 4},
  {label: "Christmas Bye Week", afterMatchWeek: 7},
  {label: "New Year Bye Week", afterMatchWeek: 7},
  {label: "Playoff Bye Week", afterMatchWeek: 10},
];

export function s20ScheduleWeek(matchWeek: number): S20ScheduleWeek | null {
  return S20_SCHEDULE_WEEKS.find(value => value.matchWeek === matchWeek) ?? null;
}
