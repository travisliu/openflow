import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-06");

async function runCli(args: string[]) {
  const stdoutData: string[] = [];
  const stderrData: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrData.push(chunk.toString());
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

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

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Timeout handling", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Timeout preserves partial logs", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/timeout-handling.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/timeout-handling.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify report.json
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    const agentResult = report.agents.find((a: any) => a.label === "timeout-agent");
    expect(agentResult).toBeDefined();
    expect(agentResult.status).toBe("timed_out");

    // Assert: Agent artifact directory exists.
    const agentArtifactDir = path.join(runDir, agentResult.artifacts.dir);
    const dirStat = await fs.stat(agentArtifactDir);
    expect(dirStat.isDirectory()).toBe(true);

    // Assert: stdout.log contains partial stdout emitted before timeout.
    const stdoutLogPath = path.join(runDir, agentResult.artifacts.stdoutPath);
    const stdoutContent = await fs.readFile(stdoutLogPath, "utf8");
    expect(stdoutContent).toContain("Partial stdout emitted before timeout");

    // Assert: stderr.log contains partial stderr emitted before timeout.
    const stderrLogPath = path.join(runDir, agentResult.artifacts.stderrPath);
    const stderrContent = await fs.readFile(stderrLogPath, "utf8");
    expect(stderrContent).toContain("Partial stderr emitted before timeout");

    // Assert: events.jsonl includes agent.timed_out.
    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf8");
    const events = eventsContent.trim().split("\n").map(line => JSON.parse(line));
    const timeoutEvent = events.find(e => e.type === "agent.timed_out" && e.payload.agentId === agentResult.id);
    expect(timeoutEvent).toBeDefined();

    // Assert: Final report references the artifact paths.
    expect(agentResult.artifacts.stdoutPath).toBeDefined();
    expect(agentResult.artifacts.stderrPath).toBeDefined();
  });
});
