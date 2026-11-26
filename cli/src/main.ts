#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { profileCommand } from "./detect.js";
import { evalAuditCommand } from "./evalAudit.js";
import { initCommand } from "./init.js";
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
  init: initCommand,
  score: scoreCommand,
  calibrate: (args) => calibrateCommand(args),
  report: reportCommand,
  profile: profileCommand,
  lesson: lessonCommand,
  "eval-audit": evalAuditCommand,
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    process.stdout.write(`usage: leanprompt <${Object.keys(commands).join("|")}> | --version\n`);
    return 0;
  }
  const handler = Object.hasOwn(commands, cmd) ? commands[cmd] : undefined;
  if (!handler) {
    process.stderr.write(`unknown command: ${cmd}\n`);
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
