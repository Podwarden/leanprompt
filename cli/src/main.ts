#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { profileCommand } from "./detect.js";
import { evalAuditCommand } from "./evalAudit.js";
import { helpText, overviewText, SPECS } from "./help.js";
import { installCommand, updateCommand } from "./install.js";
import { lessonCommand } from "./lesson.js";
import { isMain } from "./isMain.js";
import { reportCommand } from "./report/html.js";
import { calibrateCommand } from "./score/calibrate.js";
import { scoreCommand } from "./score/write.js";

// cli/src and cli/dist are the same depth below the package root.
const pkgUrl = new URL("../../package.json", import.meta.url);
export const VERSION: string = (JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string }).version;

type Handler = (args: string[]) => Promise<number>;

export const commands: Record<string, Handler> = {
  install: (args) => installCommand(args),
  init: (args) => installCommand(args, undefined, "init"),
  update: (args) => updateCommand(args),
  score: scoreCommand,
  calibrate: (args) => calibrateCommand(args),
  report: reportCommand,
  profile: profileCommand,
  lesson: lessonCommand,
  "eval-audit": evalAuditCommand,
};

function helpFor(name: string | undefined): number {
  if (name === undefined) {
    process.stdout.write(overviewText(Object.keys(commands)));
    return 0;
  }
  const key = name === "profile" ? "profile detect" : name;
  if (!SPECS.some((s) => s.name === key)) {
    process.stderr.write(`unknown command: ${name}\nRun leanprompt --help for the commands.\n`);
    return 2;
  }
  process.stdout.write(helpText(key));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    process.stdout.write(overviewText(Object.keys(commands)));
    return 0;
  }
  if (cmd === "help") return helpFor(rest[0]);
  if (rest.includes("--help") || rest.includes("-h")) {
    if (Object.hasOwn(commands, cmd)) return helpFor(cmd === "profile" ? "profile detect" : cmd);
  }
  const handler = Object.hasOwn(commands, cmd) ? commands[cmd] : undefined;
  if (!handler) {
    process.stderr.write(`unknown command: ${cmd}\nRun leanprompt --help for the commands.\n`);
    return 2;
  }
  return handler(rest);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`leanprompt: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
