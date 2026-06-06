/**
 * Tech profiles surfaced by the "Create project" wizard.
 *
 * A profile is a named bundle of run-config defaults the wizard offers when
 * adding a repo. The profile id is persisted on the repo (`repo.tech: <id>`)
 * so future banyan features can specialize behavior per tech without parsing
 * the command string.
 *
 * Today the profile only fills run defaults at creation time — adb reverse
 * and other tech-specific quirks still work via the existing heuristics. The
 * persisted `tech:` field is a forward-looking hook, intentionally cheap to
 * add now and useful later.
 *
 * `custom` is the escape hatch: pick it and you write your own command.
 */
import type { RunConfig } from "../config.js";

export interface TechProfile {
  id: string;
  label: string;
  /** One-line hint shown next to the option in the dropdown. */
  hint: string;
  /** Run-config defaults the wizard pre-fills when this profile is picked.
   *  Empty for `custom`. */
  defaults: Partial<RunConfig>;
}

export const TECH_PROFILES: readonly TechProfile[] = [
  {
    id: "node",
    label: "Node",
    hint: "npm/pnpm/yarn — Next, Vite, Express, …",
    defaults: {
      command: "npm run dev",
      port: 3000,
      portEnv: "PORT",
    },
  },
  {
    id: "spring-boot",
    label: "Spring Boot",
    hint: "Gradle or Maven backend, port 8080",
    defaults: {
      command: "./gradlew bootRun",
      port: 8080,
      portEnv: "SERVER_PORT",
      stopCommand: "./gradlew --stop",
    },
  },
  {
    id: "android",
    label: "Android",
    hint: "Gradle install + adb start (no port)",
    defaults: {
      command:
        "./gradlew :app:installDebug && adb shell am start -n <your.package>/.MainActivity",
      stopCommand: "./gradlew --stop",
    },
  },
  {
    id: "django",
    label: "Django",
    hint: "manage.py runserver, port 8000",
    defaults: {
      command: "python manage.py runserver 0.0.0.0:$PORT",
      port: 8000,
      portEnv: "PORT",
    },
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Type your own command",
    defaults: {},
  },
];

const PROFILE_BY_ID = new Map(TECH_PROFILES.map((p) => [p.id, p]));

export function getTechProfile(id: string): TechProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

export function isKnownTech(id: string): boolean {
  return PROFILE_BY_ID.has(id);
}

/**
 * Map an `inferRun()` stack label back to a wizard profile id. The mapping is
 * deliberately conservative: we only recognise the stacks the wizard offers,
 * so an exotic detection (e.g. "go") returns null and the user starts on
 * "custom" with the command pre-filled by the probe endpoint.
 */
export function matchStackToProfile(stackLabel: string): string | null {
  const s = stackLabel.toLowerCase();
  if (s.startsWith("node")) return "node";
  if (s.startsWith("android")) return "android";
  if (s.includes("spring boot")) return "spring-boot";
  if (s.includes("django")) return "django";
  return null;
}
