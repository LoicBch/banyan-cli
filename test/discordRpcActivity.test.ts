import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildActivity } from "../src/integrations/discord-rpc/activity.js";
import { DEFAULT_CONFIG } from "../src/integrations/discord-rpc/config.js";
import type { BanyanActivity } from "../src/integrations/discord-rpc/config.js";

const START = "2026-01-01T00:00:00.000Z";

function single(features: string[], totalWorktrees = features.length): BanyanActivity {
  return {
    projects: [{ name: "my-project", features, totalWorktrees }],
    startTime: START,
  };
}

describe("discord-rpc activity — null + totals", () => {
  it("returns null when no projects active", () => {
    const result = buildActivity({ projects: [], startTime: START }, DEFAULT_CONFIG);
    assert.equal(result, null);
  });

  it("details = totals (features · projects) for a single project", () => {
    const result = buildActivity(single(["login", "profile"]), DEFAULT_CONFIG);
    assert.equal(result?.details, "2 features · 1 project");
  });

  it("singular pluralization for 1 feature / 1 project", () => {
    const result = buildActivity(single(["login"]), DEFAULT_CONFIG);
    assert.equal(result?.details, "1 feature · 1 project");
  });

  it("details = totals (features · projects) when aggregated", () => {
    const aggregate: BanyanActivity = {
      projects: [
        { name: "proj-a", features: ["x", "y", "z"], totalWorktrees: 3 },
        { name: "proj-b", features: ["m"], totalWorktrees: 2 },
      ],
      startTime: START,
    };
    const result = buildActivity(aggregate, DEFAULT_CONFIG);
    assert.equal(result?.details, "4 features · 2 projects");
  });
});

describe("discord-rpc activity — state line (project names)", () => {
  it("lists the single active project on the state line", () => {
    const result = buildActivity(single(["login"]), DEFAULT_CONFIG);
    assert.equal(result?.state, "my-project");
  });

  it("joins multiple project names with middot", () => {
    const result = buildActivity(
      {
        projects: [
          { name: "proj-a", features: ["x"], totalWorktrees: 1 },
          { name: "proj-b", features: ["y"], totalWorktrees: 1 },
        ],
        startTime: START,
      },
      DEFAULT_CONFIG,
    );
    assert.equal(result?.state, "proj-a · proj-b");
  });

  it("truncates a long project list with +N overflow", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `project-with-a-fairly-long-name-${i}`,
      features: ["x"],
      totalWorktrees: 1,
    }));
    const result = buildActivity({ projects: many, startTime: START }, DEFAULT_CONFIG);
    assert.match(result!.state!, /\+\d+$/);
    assert.ok(result!.state!.length <= 128);
  });
});

describe("discord-rpc activity — images & buttons", () => {
  it("emits large + small image when keys are set", () => {
    const result = buildActivity(single(["x"]), DEFAULT_CONFIG);
    assert.equal(result?.largeImageKey, "banyan-logo");
    assert.equal(result?.smallImageKey, "status-working");
  });

  it("skips image fields when their key is empty", () => {
    const result = buildActivity(single(["x"]), {
      ...DEFAULT_CONFIG,
      largeImageKey: "",
      smallImageKey: "",
    });
    assert.equal(result?.largeImageKey, undefined);
    assert.equal(result?.smallImageKey, undefined);
  });

  it("emits Open Dashboard button only for https URLs", () => {
    const httpsResult = buildActivity(
      { ...single(["x"]), dashboardUrl: "https://x.trycloudflare.com" },
      DEFAULT_CONFIG,
    );
    assert.equal(httpsResult?.buttons?.[0]?.label, "Open Dashboard");

    const httpResult = buildActivity(
      { ...single(["x"]), dashboardUrl: "http://localhost:7777" },
      DEFAULT_CONFIG,
    );
    assert.equal(httpResult?.buttons, undefined);
  });

  it("sets startTimestamp from startTime", () => {
    const result = buildActivity(single(["x"]), DEFAULT_CONFIG);
    assert.equal(result?.startTimestamp, Math.floor(new Date(START).getTime() / 1000));
  });
});
