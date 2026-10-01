import assert from "node:assert/strict";
import test from "node:test";

import {buildFaPages, parseFaCustomId} from "../src/commands/pool.ts";

function player(index, status = "FA") {
  return {
    sprocketPlayerId: String(index),
    name: `Player ${String(index).padStart(2, "0")} ${"x".repeat(70)}`,
    salary: 8.5,
    league: "CL",
    status,
  };
}

test("FA pages stay inside Discord message limits and preserve all players", () => {
  const players = [
    ...Array.from({length: 18}, (_, index) => player(index + 1, "FA")),
    ...Array.from({length: 18}, (_, index) => player(index + 19, "PEND")),
  ];

  const pages = buildFaPages("CL", "BOTH", null, players);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.length < 2000));

  const renderedPlayers = pages.reduce(
    (total, page) => total + (page.match(/^• /gm)?.length ?? 0),
    0,
  );
  assert.equal(renderedPlayers, players.length);
  assert.match(pages[0], /CL FA \+ PEND/);
  assert.match(pages[0], /Page \*\*1\//);
  assert.match(pages.at(-1), new RegExp(`Page \\*\\*${pages.length}/${pages.length}\\*\\*`));
});

test("FA pages display exact salary filters", () => {
  const pages = buildFaPages("AL", "FA", 7.5, [
    {...player(1, "FA"), league: "AL", salary: 7.5},
  ]);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /AL FA/);
  assert.match(pages[0], /Salary: \*\*7\.5\*\*/);
});

test("FA pagination custom IDs validate division, status, salary, and page", () => {
  assert.deepEqual(parseFaCustomId("fa:CL:BOTH:*:2"), {
    division: "CL",
    status: "BOTH",
    salary: null,
    pageIndex: 2,
  });
  assert.deepEqual(parseFaCustomId("fa:ML:PEND:9.5:1"), {
    division: "ML",
    status: "PEND",
    salary: 9.5,
    pageIndex: 1,
  });
  assert.equal(parseFaCustomId("fa:XX:BOTH:*:0"), null);
  assert.equal(parseFaCustomId("fa:CL:NOPE:*:0"), null);
  assert.equal(parseFaCustomId("fa:CL:FA:8.5:-1"), null);
});
