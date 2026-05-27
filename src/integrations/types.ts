/**
 * Provider-agnostic task ingestion. Each integration (ClickUp, Linear, Jira,
 * GitHub Issues, …) implements `TaskSource` by polling its API and returning
 * a normalised list of tasks. Banyan dedupes those against its local inbox,
 * shows the unseen ones in the dashboard, and lets the user spawn a worktree
 * from any of them on demand.
 *
 * The Task shape stays deliberately minimal — anything provider-specific goes
 * in `raw` so the UI can surface it without us hard-coding every concept.
 */

export interface Task {
  /** Unique within a source: `<sourceName>:<provider-task-id>` once normalised. */
  id: string;
  /** Source name (matches IntegrationConfig.sources[].name). */
  source: string;
  /** Original provider id (without the source prefix). */
  externalId: string;
  /** Short title shown in the inbox card. */
  title: string;
  /** Free-form description / body. Used as the agent's initial prompt. */
  description?: string;
  /** Assignee identifiers as the provider returns them (email, username, etc.). */
  assignees: string[];
  /** Current status label, provider-defined ("to do", "in progress", "done"…). */
  status?: string;
  /** Web URL to the task in the provider's UI. */
  url?: string;
  /** When the provider created the task (ISO 8601). */
  createdAt?: string;
  /** Last update on the provider's side (ISO 8601). */
  updatedAt?: string;
  /** Provider-suggested labels / tags / custom fields, opaque to banyan. */
  tags?: string[];
  /** Raw provider payload for advanced consumers (UI tooltip, debugging). */
  raw?: unknown;
}

/** Rule applied to incoming tasks. All conditions must hold (AND semantics). */
export interface IntegrationRule {
  /** Source name this rule applies to. */
  source: string;
  /** Filters — every present field is AND'd. Omitted = no constraint. */
  when?: {
    assigneesAny?: string[];   // task assignee ∈ this list
    statusesAny?: string[];    // task status ∈ this list (case-insensitive)
    tagsAny?: string[];        // task has any of these tags
  };
  /** What to suggest when a task matches (the user still confirms via the inbox). */
  suggest: {
    /** Project name to spawn the worktree in. */
    project: string;
    /** Agent mode to default to in the spawn modal. */
    mode?: "interactive" | "assisted" | "autonomous" | "autopilot";
    /** Prefix passed to wtAll (e.g. "fix"). */
    prefix?: string;
  };
}

export interface SourceConfig {
  /** Provider type. Determines which adapter to load. */
  type: "clickup";
  /** Stable name referenced by rules — pick anything unique. */
  name: string;
  /** Poll cadence. Default: 5 min. */
  pollIntervalMin?: number;
  /** Provider-specific opts (apiToken, listId, etc.). Validated by the adapter. */
  options: Record<string, unknown>;
}

export interface IntegrationsConfig {
  sources: SourceConfig[];
  rules: IntegrationRule[];
}

/** Each provider implements this. `pull()` returns whatever the provider knows
 *  right now — banyan does the dedup against the inbox. */
export interface TaskSource {
  readonly name: string;
  readonly type: string;
  /** Cadence in minutes (advisory — the scheduler enforces it). */
  readonly pollIntervalMin: number;
  /** Fetch the current set of tasks. Should not throw on transient failures —
   *  return an empty array + log. Adapters can throw for misconfig (bad token). */
  pull(): Promise<Task[]>;
}
