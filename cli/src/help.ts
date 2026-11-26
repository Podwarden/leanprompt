/**
 * One table of command specs. Every command builds its `parseArgs` options from it (`optionsFor`),
 * and `--help` prints from it, so the help text cannot list a flag the parser rejects or miss one it accepts.
 */
export interface FlagSpec {
  name: string;
  type: "string" | "boolean";
  /** Placeholder for the value, shown in help. */
  arg?: string;
  desc: string;
}

export interface CommandSpec {
  name: string;
  summary: string;
  /** Positional arguments, shown in the usage line. */
  positionals?: string;
  flags: FlagSpec[];
}

const DIR: FlagSpec = { name: "dir", type: "string", arg: "<project>", desc: "the project folder (default: the current directory)" };

export const SPECS: CommandSpec[] = [
  {
    name: "init",
    summary: "Install the skills for the assistants this project uses.",
    flags: [
      { name: "assistant", type: "string", arg: "<name>", desc: "force one assistant instead of detecting: claude, codex, opencode, cursor or agents-md" },
      { name: "global", type: "boolean", desc: "install into your home directory instead of the project" },
      { name: "dry-run", type: "boolean", desc: "list what would be written or skipped; write nothing" },
      DIR,
    ],
  },
  {
    name: "score",
    summary: "Write .leanprompt/score.json, measured from the usage log or static from the findings.",
    flags: [
      { name: "measured", type: "string", arg: "[<usage.jsonl>]", desc: "score from the usage log (default .leanprompt/usage.jsonl; needs at least 50 calls)" },
      { name: "static", type: "string", arg: "[<findings.json>]", desc: "score from the audit's findings (default .leanprompt/findings.json)" },
      DIR,
    ],
  },
  {
    name: "calibrate",
    summary: "Fit the static score's weights to this app from a trial run.",
    flags: [
      { name: "findings", type: "string", arg: "<findings.json>", desc: "the findings file (default .leanprompt/findings.json)" },
      { name: "usage", type: "string", arg: "<usage.jsonl>", desc: "the usage log (default .leanprompt/usage.jsonl)" },
      { name: "synthetic", type: "boolean", desc: "the log comes from a synthetic run, not real traffic" },
      { name: "yes", type: "boolean", desc: "write .leanprompt/weights.json without asking" },
      DIR,
    ],
  },
  {
    name: "profile detect",
    summary: "Read engine cache facts from LM Warden into leanprompt.yaml.",
    flags: [
      { name: "lmwarden", type: "string", arg: "<url>", desc: "LM Warden base URL (required)" },
      { name: "token-env", type: "string", arg: "<VAR>", desc: "name of the environment variable holding the API key (default LMWARDEN_API_KEY)" },
      { name: "model", type: "string", arg: "<name>", desc: "the model, when the key can use several" },
    ],
  },
  {
    name: "report",
    summary: "Write the findings and the score to a local HTML page.",
    flags: [
      { name: "html", type: "boolean", desc: "write the HTML page (required)" },
      { name: "out", type: "string", arg: "<file>", desc: "where to write it (default .leanprompt/report.html)" },
      DIR,
    ],
  },
  {
    name: "lesson",
    summary: "Draft a lesson-learned issue on this machine; sends nothing.",
    flags: [
      { name: "rule", type: "string", arg: "<id>", desc: "the rule the lesson is about, for example LP-PC-03 (needed unless you have a measured score)" },
      { name: "before", type: "string", arg: "<score.json>", desc: "an older score.json to compare against" },
      DIR,
    ],
  },
  {
    name: "eval-audit",
    summary: "Score an audit's findings against a seeded example case.",
    positionals: "<case-dir> <findings.json>",
    flags: [{ name: "form", type: "string", arg: "before|after", desc: "which form of the case the findings describe (default before)" }],
  },
];

export const spec = (name: string): CommandSpec => {
  const s = SPECS.find((x) => x.name === name);
  if (!s) throw new Error(`no help for ${name}`);
  return s;
};

/** The `parseArgs` options object for a command. */
export function optionsFor(name: string): Record<string, { type: "string" | "boolean" }> {
  return Object.fromEntries(spec(name).flags.map((f) => [f.name, { type: f.type }]));
}

const flagLabel = (f: FlagSpec): string => `--${f.name}${f.arg ? " " + f.arg : ""}`;

export function usageLine(s: CommandSpec): string {
  const flags = s.flags.map((f) => `[${flagLabel(f)}]`).join(" ");
  return `leanprompt ${s.name}${s.positionals ? " " + s.positionals : ""} ${flags}`;
}

export function helpText(name: string): string {
  const s = spec(name);
  const labels = s.flags.map(flagLabel);
  const w = Math.max(...labels.map((l) => l.length));
  const lines = [s.summary, "", `usage: ${usageLine(s)}`, "", "options:"];
  s.flags.forEach((f, i) => lines.push(`  ${labels[i]!.padEnd(w)}  ${f.desc}`));
  lines.push(`  ${"--help".padEnd(w)}  show this text`);
  return lines.join("\n") + "\n";
}

export function overviewText(commandNames: string[]): string {
  const rows = commandNames.map((c) => {
    const s = SPECS.find((x) => x.name.split(" ")[0] === c);
    return `  ${c.padEnd(11)}${s?.summary ?? ""}`;
  });
  return ["usage: leanprompt <command> [options]", "", "commands:", ...rows, "", "Run leanprompt <command> --help for a command's options.", "leanprompt --version prints the version.", ""].join("\n");
}
