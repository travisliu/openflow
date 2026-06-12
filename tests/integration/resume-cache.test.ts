import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-resume-cache");
const FAKE_PROVIDER = path.resolve("tests/fixtures/fake-counter-provider.mjs");

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  let error: any = null;
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return { error };
}

async function listRunDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readCounter(counterPath: string): Promise<string> {
  return fs.readFile(counterPath, "utf8");
}

async function writeConfig(configPath: string) {
  await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultModel: null
security:
  passEnv:
    - OPENFLOW_FAKE_PROVIDER_COUNTER
    - OPENFLOW_FAKE_PROVIDER_JSON
    - OPENFLOW_FAKE_PROVIDER_INVALID_JSON
    - OPENFLOW_FAKE_PROVIDER_FAIL_ON
    - OPENFLOW_FAKE_PROVIDER_EXIT_CODE
`, "utf8");
}

describe("resume/cache", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_PROVIDER_COUNTER;
    delete process.env.OPENFLOW_FAKE_PROVIDER_JSON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_INVALID_JSON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_FAIL_ON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_EXIT_CODE;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("resumes a sequential workflow through the friendly resume command without invoking the provider again", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "resume-cache", description: "resume cache test" };
const a = await agent({ id: "a", prompt: "first" });
const b = await agent({ id: "b", prompt: "second" });
export default [a.text, b.text];
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((agent: any) => agent.cache?.hit)).toEqual([true, true]);
    expect(await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8")).toContain('"sequence":2');
  });

  it("uses longest unchanged prefix after the workflow script is edited", async () => {
    const workflowPath = path.join(TEMP_DIR, "edited.workflow.js");
    const configPath = path.join(TEMP_DIR, "edited.config.yaml");
    const runsDir = path.join(TEMP_DIR, "edited-runs");
    const counterPath = path.join(TEMP_DIR, "edited-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "edited-resume", description: "edited resume test" };
await agent({ id: "a", prompt: "unchanged a" });
await agent({ id: "b", prompt: "old b" });
await agent({ id: "c", prompt: "unchanged c" });
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    const [firstRunId] = await listRunDirs(runsDir);

    await fs.writeFile(workflowPath, `
export const meta = { name: "edited-resume", description: "edited resume test" };
await agent({ id: "a", prompt: "unchanged a" });
await agent({ id: "b", prompt: "new b" });
await agent({ id: "c", prompt: "unchanged c" });
export default "done";
`, "utf8");

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((agent: any) => agent.cache?.hit || false)).toEqual([true, false, false]);
  });

  it("resumes parallel and fixed-loop workflows by invocation sequence", async () => {
    const workflowPath = path.join(TEMP_DIR, "parallel-loop.workflow.js");
    const configPath = path.join(TEMP_DIR, "parallel-loop.config.yaml");
    const runsDir = path.join(TEMP_DIR, "parallel-loop-runs");
    const counterPath = path.join(TEMP_DIR, "parallel-loop-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "parallel-loop", description: "parallel and loop resume test" };
await parallel({
  a: () => agent({ id: "parallel-a", prompt: "parallel a" }),
  b: () => agent({ id: "parallel-b", prompt: "parallel b" })
});
for (let i = 0; i < 3; i++) {
  await agent({ id: \`round-\${i}\`, prompt: \`round \${i}\` });
}
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", path.join(runsDir, firstRunId!)])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
  });

  it("does not cache schema validation failures", async () => {
    const workflowPath = path.join(TEMP_DIR, "schema-invalid.workflow.js");
    const configPath = path.join(TEMP_DIR, "schema-invalid.config.yaml");
    const runsDir = path.join(TEMP_DIR, "schema-invalid-runs");
    const counterPath = path.join(TEMP_DIR, "schema-invalid-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "schema-invalid", description: "schema invalid resume test" };
await agent({
  id: "schema-agent",
  prompt: "return schema",
  schema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
  structuredOutput: { transport: "prompt" }
});
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPENFLOW_FAKE_PROVIDER_INVALID_JSON = "1";

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");
  });

  it("reuses only the successful prefix before a failed middle call", async () => {
    const workflowPath = path.join(TEMP_DIR, "failed-middle.workflow.js");
    const configPath = path.join(TEMP_DIR, "failed-middle.config.yaml");
    const runsDir = path.join(TEMP_DIR, "failed-middle-runs");
    const counterPath = path.join(TEMP_DIR, "failed-middle-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "failed-middle", description: "failed middle resume test" };
await agent({ id: "a", prompt: "ok a" });
await agent({ id: "b", prompt: "fail b" });
await agent({ id: "c", prompt: "ok c" });
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPENFLOW_FAKE_PROVIDER_FAIL_ON = "fail b";

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
  });

  it("--no-cache skips reads and cache-index writes but still writes calls.jsonl", async () => {
    const workflowPath = path.join(TEMP_DIR, "no-cache.workflow.js");
    const configPath = path.join(TEMP_DIR, "no-cache.config.yaml");
    const runsDir = path.join(TEMP_DIR, "no-cache-runs");
    const counterPath = path.join(TEMP_DIR, "no-cache-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "no-cache", description: "no cache resume test" };
await agent({ id: "a", prompt: "no cache" });
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    const [firstRunId] = await listRunDirs(runsDir);
    expect((await runCli(["resume", firstRunId!, "--out", runsDir, "--no-cache"])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");

    const secondRunId = (await listRunDirs(runsDir)).find((id) => id !== firstRunId)!;
    const index = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "cache-index.json"), "utf8"));
    expect(index.entries).toEqual([]);
    expect(await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8")).toContain('"sequence":1');
  });

  it("falls back to calls.jsonl when cache-index.json is missing", async () => {
    const workflowPath = path.join(TEMP_DIR, "journal.workflow.js");
    const configPath = path.join(TEMP_DIR, "journal.config.yaml");
    const runsDir = path.join(TEMP_DIR, "journal-runs");
    const counterPath = path.join(TEMP_DIR, "journal-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "journal", description: "journal rebuild test" };
await agent({ id: "a", prompt: "journal a" });
export default "done";
`, "utf8");
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    const [firstRunId] = await listRunDirs(runsDir);
    await fs.rm(path.join(runsDir, firstRunId!, "cache-index.json"), { force: true });

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
  });

  it("reports a clear usage error for runs without run-input.json", async () => {
    const runsDir = path.join(TEMP_DIR, "bad-runs");
    await fs.mkdir(path.join(runsDir, "run-without-input"), { recursive: true });

    const result = await runCli(["resume", "run-without-input", "--out", runsDir]);
    expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(result.error.message).toContain("run-input.json");
  });
});
