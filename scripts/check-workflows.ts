#!/usr/bin/env bun
// Lockdown check for self-hosted runners (`proxmox`, `desktop`, `self-hosted`).
//
// Usage: bun check-workflows.ts <file.yml>...   (register.sh feeds it a repo's workflows)
//
// Every job whose `runs-on` could reach a runner (names `proxmox`, `desktop` or
// `self-hosted`, or is an expression) must:
//   - live in a workflow triggered only by push or pull_request
//     (never pull_request_target, workflow_run, issue_comment or anything a fork can drive), and
//   - have exactly the same-repo guard as its `if:`, or that guard in brackets followed by `&& ...`:
//       github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
// A guard that only contains the text (`... || true`) fails. Exits 1 if any job fails.
import { basename } from "node:path";

const GUARD =
  "github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository";
const ALLOWED = new Set(["push", "pull_request"]);

type Job = { runsOn: unknown; if: unknown };
type Workflow = { on: unknown; jobs: Record<string, Job> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkflow(text: string): Workflow {
  const parsed: unknown = Bun.YAML.parse(text);
  if (!isRecord(parsed)) return { on: undefined, jobs: {} };
  // YAML 1.1 parsers read a bare `on:` key as boolean true; accept either spelling.
  const on = parsed["on"] ?? parsed["true"];
  const rawJobs = parsed["jobs"];
  const jobs: Record<string, Job> = {};
  if (isRecord(rawJobs)) {
    for (const [id, job] of Object.entries(rawJobs)) {
      jobs[id] = isRecord(job)
        ? { runsOn: job["runs-on"], if: job["if"] }
        : { runsOn: undefined, if: undefined };
    }
  }
  return { on, jobs };
}

function triggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isRecord(on)) return Object.keys(on);
  return [];
}

function reachesRunner(runsOn: unknown): boolean {
  const text = JSON.stringify(runsOn ?? "");
  return (
    text.includes("proxmox") ||
    text.includes("desktop") ||
    text.includes("self-hosted") ||
    text.includes("${{")
  );
}

// The `runs-on` of a job as written: a string as is, an array as `[a, b]`, an object as JSON.
function renderRunsOn(runsOn: unknown): string {
  if (typeof runsOn === "string") return runsOn.replace(/\s+/g, " ").trim();
  if (Array.isArray(runsOn))
    return `[${runsOn.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ")}]`;
  return JSON.stringify(runsOn);
}

function guarded(cond: unknown): boolean {
  const c = (typeof cond === "string" ? cond : "")
    .replace(/^\s*\$\{\{|\}\}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return c === GUARD || c.startsWith(`(${GUARD}) && `);
}

function checkWorkflow(name: string, text: string): { failures: string[]; reached: number } {
  const wf = parseWorkflow(text);
  const failures: string[] = [];
  let reached = 0;
  const on = triggers(wf.on);
  for (const [id, job] of Object.entries(wf.jobs)) {
    if (!reachesRunner(job.runsOn)) continue;
    reached++;
    const runsOn = renderRunsOn(job.runsOn);
    const bad = on.filter((t) => !ALLOWED.has(t));
    if (bad.length)
      failures.push(
        `${name}: job ${id} runs on ${runsOn} but the workflow triggers on ${bad.join(", ")}`,
      );
    if (!guarded(job.if))
      failures.push(
        `${name}: job ${id} runs on ${runsOn} without exactly the same-repo guard: ${GUARD}`,
      );
  }
  return { failures, reached };
}

if (import.meta.main) {
  const files = Bun.argv.slice(2);
  const failures: string[] = [];
  let selfHosted = 0;
  for (const f of files) {
    const text = await Bun.file(f).text();
    const result = checkWorkflow(basename(f), text);
    selfHosted += result.reached;
    failures.push(...result.failures);
  }
  for (const line of failures) console.log(`FAIL ${line}`);
  console.log(
    `${files.length} workflow(s) read, ${selfHosted} self-hosted job(s), ${failures.length} failure(s)`,
  );
  process.exit(failures.length ? 1 : 0);
}
