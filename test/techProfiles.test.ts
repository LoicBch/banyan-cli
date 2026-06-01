import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TECH_PROFILES,
  getTechProfile,
  isKnownTech,
  matchStackToProfile,
} from "../src/dashboard/techProfiles.js";

describe("TECH_PROFILES", () => {
  it("includes the v1 profiles plus 'custom'", () => {
    const ids = TECH_PROFILES.map((p) => p.id).sort();
    assert.deepEqual(ids, ["android", "custom", "django", "node", "spring-boot"]);
  });

  it("every non-custom profile has a non-empty default command", () => {
    for (const p of TECH_PROFILES) {
      if (p.id === "custom") continue;
      assert.ok(
        typeof p.defaults.command === "string" && p.defaults.command.length > 0,
        `profile '${p.id}' should pre-fill a command`,
      );
    }
  });

  it("custom profile has empty defaults", () => {
    const custom = getTechProfile("custom");
    assert.ok(custom);
    assert.deepEqual(custom.defaults, {});
  });

  it("spring-boot includes a stopCommand for the gradle daemon", () => {
    const sb = getTechProfile("spring-boot");
    assert.equal(sb?.defaults.stopCommand, "./gradlew --stop");
  });

  it("android has no port (no port concept on Android)", () => {
    const a = getTechProfile("android");
    assert.equal(a?.defaults.port, undefined);
    assert.equal(a?.defaults.portEnv, undefined);
  });
});

describe("getTechProfile", () => {
  it("returns the profile for a known id", () => {
    assert.equal(getTechProfile("node")?.label, "Node");
  });
  it("returns undefined for an unknown id", () => {
    assert.equal(getTechProfile("rust"), undefined);
  });
});

describe("isKnownTech", () => {
  it("recognises all listed profiles including custom", () => {
    for (const id of ["node", "spring-boot", "android", "django", "custom"]) {
      assert.equal(isKnownTech(id), true, id);
    }
  });
  it("rejects unknown ids", () => {
    assert.equal(isKnownTech("ruby"), false);
    assert.equal(isKnownTech(""), false);
  });
});

describe("matchStackToProfile", () => {
  it("maps inferRun's node stack labels", () => {
    assert.equal(matchStackToProfile("node + pnpm"), "node");
    assert.equal(matchStackToProfile("node + npm"), "node");
    assert.equal(matchStackToProfile("Node + yarn"), "node");
  });

  it("maps inferRun's android stack label", () => {
    assert.equal(matchStackToProfile("android (gradle)"), "android");
  });

  it("maps gradle/maven spring boot to spring-boot", () => {
    assert.equal(matchStackToProfile("gradle + spring boot"), "spring-boot");
    assert.equal(matchStackToProfile("maven + spring boot"), "spring-boot");
  });

  it("maps django stacks", () => {
    assert.equal(matchStackToProfile("python + django (poetry)"), "django");
  });

  it("returns null for stacks the wizard doesn't offer (go, flask, fastapi)", () => {
    assert.equal(matchStackToProfile("go"), null);
    assert.equal(matchStackToProfile("python + flask"), null);
    assert.equal(matchStackToProfile("python + fastapi (uv)"), null);
  });
});
