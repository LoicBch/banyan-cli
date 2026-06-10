import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, expandHome, contractHome, getProject, getRepo } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { homedir } from "node:os";
import path from "node:path";

describe("expandHome", () => {
  it("expands leading ~/", () => {
    assert.equal(expandHome("~/foo"), path.join(homedir(), "foo"));
  });
  it("expands bare ~", () => {
    assert.equal(expandHome("~"), homedir());
  });
  it("leaves absolute paths alone", () => {
    assert.equal(expandHome("/abs/path"), "/abs/path");
  });
  it("leaves relative paths alone", () => {
    assert.equal(expandHome("rel/path"), "rel/path");
  });
});

describe("contractHome", () => {
  it("contracts $HOME to ~", () => {
    assert.equal(contractHome(homedir()), "~");
  });
  it("contracts $HOME/foo to ~/foo", () => {
    assert.equal(contractHome(path.join(homedir(), "foo")), "~/foo");
  });
  it("leaves unrelated paths alone", () => {
    assert.equal(contractHome("/tmp/foo"), "/tmp/foo");
  });
});

describe("validateConfig", () => {
  const source = "test:config";
  const minimal = {
    version: 1,
    projects: [
      {
        name: "p1",
        repos: [{ name: "front", path: "/tmp/r" }],
      },
    ],
  };

  it("accepts a minimal valid config", () => {
    const cfg = validateConfig(minimal, source);
    assert.equal(cfg.version, 1);
    assert.equal(cfg.projects.length, 1);
    assert.equal(cfg.projects[0]?.repos[0]?.name, "front");
  });

  it("rejects unknown version", () => {
    assert.throws(
      () => validateConfig({ ...minimal, version: 2 }, source),
      ConfigError,
    );
  });

  it("rejects non-mapping root", () => {
    assert.throws(() => validateConfig([], source), ConfigError);
    assert.throws(() => validateConfig("nope", source), ConfigError);
  });

  it("rejects missing projects array", () => {
    assert.throws(() => validateConfig({ version: 1 }, source), ConfigError);
  });

  it("accepts an optional llm.openrouterApiKey", () => {
    const cfg = validateConfig(
      { ...minimal, llm: { openrouterApiKey: "or-test-123" } },
      source,
    );
    assert.equal(cfg.llm?.openrouterApiKey, "or-test-123");
  });

  it("drops an empty llm.openrouterApiKey instead of failing", () => {
    const cfg = validateConfig({ ...minimal, llm: { openrouterApiKey: "" } }, source);
    assert.equal(cfg.llm, undefined);
  });

  it("rejects a non-string llm.openrouterApiKey", () => {
    assert.throws(
      () => validateConfig({ ...minimal, llm: { openrouterApiKey: 42 } }, source),
      /openrouterApiKey must be a string/,
    );
  });

  it("rejects duplicate project names", () => {
    const dup = {
      version: 1,
      projects: [minimal.projects[0], minimal.projects[0]],
    };
    assert.throws(() => validateConfig(dup, source), ConfigError);
  });

  it("rejects empty repos list", () => {
    const bad = {
      version: 1,
      projects: [{ name: "p", repos: [] }],
    };
    assert.throws(() => validateConfig(bad, source), ConfigError);
  });

  it("rejects duplicate repo names within a project", () => {
    const bad = {
      version: 1,
      projects: [
        {
          name: "p",
          repos: [
            { name: "front", path: "/a" },
            { name: "front", path: "/b" },
          ],
        },
      ],
    };
    assert.throws(() => validateConfig(bad, source), ConfigError);
  });

  it("rejects missing required fields", () => {
    assert.throws(
      () =>
        validateConfig(
          {
            version: 1,
            projects: [{ repos: [{ name: "f", path: "/r" }] }],
          },
          source,
        ),
      ConfigError,
    );
  });

  it("accepts a repo with run config", () => {
    const cfg = validateConfig(
      {
        version: 1,
        projects: [
          {
            name: "p",
            repos: [
              {
                name: "back",
                path: "/tmp/r",
                run: {
                  command: "./gradlew bootRun",
                  port: 8080,
                  portEnv: "SERVER_PORT",
                },
              },
            ],
          },
        ],
      },
      source,
    );
    const run = cfg.projects[0]?.repos[0]?.run;
    assert.equal(run?.command, "./gradlew bootRun");
    assert.equal(run?.port, 8080);
    assert.equal(run?.portEnv, "SERVER_PORT");
  });

  it("rejects run without command", () => {
    assert.throws(
      () =>
        validateConfig(
          {
            version: 1,
            projects: [
              {
                name: "p",
                repos: [{ name: "r", path: "/tmp/r", run: { port: 8080 } }],
              },
            ],
          },
          source,
        ),
      ConfigError,
    );
  });

  it("rejects run.port that is not an integer", () => {
    assert.throws(
      () =>
        validateConfig(
          {
            version: 1,
            projects: [
              {
                name: "p",
                repos: [
                  { name: "r", path: "/tmp/r", run: { command: "c", port: "8080" } },
                ],
              },
            ],
          },
          source,
        ),
      ConfigError,
    );
  });

  it("expands ~ in paths", () => {
    const cfg = validateConfig(
      {
        version: 1,
        projects: [
          {
            name: "p",
            repos: [{ name: "front", path: "~/repo" }],
          },
        ],
      },
      source,
    );
    assert.equal(cfg.projects[0]?.repos[0]?.path, path.join(homedir(), "repo"));
  });
});

describe("getProject / getRepo", () => {
  const cfg = validateConfig(
    {
      version: 1,
      projects: [
        {
          name: "demo",
          repos: [
            { name: "front", path: "/a" },
            { name: "back", path: "/b" },
          ],
        },
      ],
    },
    "t",
  );

  it("finds project by name", () => {
    assert.equal(getProject(cfg, "demo").name, "demo");
  });

  it("throws on unknown project", () => {
    assert.throws(() => getProject(cfg, "nope"), ConfigError);
  });

  it("finds repo by name", () => {
    const p = getProject(cfg, "demo");
    assert.equal(getRepo(p, "back").path, "/b");
  });

  it("throws on unknown repo", () => {
    const p = getProject(cfg, "demo");
    assert.throws(() => getRepo(p, "nope"), ConfigError);
  });
});
