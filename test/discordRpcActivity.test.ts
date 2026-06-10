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

describe("discord-rpc activity — single project", () => {
  it("returns null when no projects active", () => {
    const result = buildActivity({ projects: [], startTime: START }, DEFAULT_CONFIG);
    assert.equal(result, null);
  });

  it("puts features on details line with middot separator", () => {
    const result = buildActivity(single(["login", "profile", "settings"]), DEFAULT_CONFIG);
    assert.equal(result?.details, "login · profile · settings");
  });

  it("shows project name with leaf emoji and count on state", () => {
    const result = buildActivity(single(["login", "profile"], 2), DEFAULT_CONFIG);
    assert.equal(result?.state, "🌿 my-project · 2 features");
  });

  it("differentiates active vs total worktrees", () => {
    const result = buildActivity(single(["login"], 5), DEFAULT_CONFIG);
    assert.equal(result?.state, "🌿 my-project · 1 of 5 features");
  });

  it("singular vs plural", () => {
    assert.equal(
      buildActivity(single(["login"], 1), DEFAULT_CONFIG)?.state,
      "🌿 my-project · 1 feature",
    );
  });

  it("truncates feature list with +N overflow", () => {
    const many = Array.from({ length: 30 }, (_, i) => `feature-with-a-fairly-long-name-${i}`);
    const result = buildActivity(single(many, 30), DEFAULT_CONFIG);
    // The details line must contain at least one feature and an overflow marker.
    assert.match(result!.details!, /\+\d+$/);
    assert.ok(result!.details!.length <= 128);
  });
});

describe("discord-rpc activity — aggregate", () => {
  const aggregate: BanyanActivity = {
    projects: [
      { name: "proj-a", features: ["x", "y", "z"], totalWorktrees: 3 },
      { name: "proj-b", features: ["m"], totalWorktrees: 2 },
    ],
    startTime: START,
  };

  it("shows project names with feature counts on details line", () => {
    const result = buildActivity(aggregate, DEFAULT_CONFIG);
    assert.equal(result?.details, "proj-a (3) · proj-b (1)");
  });

  it("totals projects and features on state line", () => {
    const result = buildActivity(aggregate, DEFAULT_CONFIG);
    assert.equal(result?.state, "🌐 2 projects · 4 features");
  });
});

describe("discord-rpc activity — images & buttons", () => {
  it("always emits large + small image when active", () => {
    const result = buildActivity(single(["x"]), DEFAULT_CONFIG);
    assert.equal(result?.largeImageKey, "banyan-logo");
    assert.equal(result?.smallImageKey, "status-working");
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
