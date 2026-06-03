import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pipeline-barrier");

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

describe("Pipeline stage-barrier integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("stage-barrier blocks stage2 until stage1 completes for all eligible items", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/pipeline-stage-barrier.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--concurrency",
      "2"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs).toHaveLength(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.status).toBe("succeeded");

    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf8");
    const events = eventsContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    const logMessages = events
      .filter((e) => e.type === "workflow.log")
      .map((e) => e.payload.message);

    const idxItem2S2Started = logMessages.indexOf("stage2 started for item2-s1");
    const idxItem1S1Completed = logMessages.indexOf("stage1 completed for item1");

    expect(idxItem2S2Started).toBeGreaterThan(-1);
    expect(idxItem1S1Completed).toBeGreaterThan(-1);

    expect(idxItem2S2Started).toBeGreaterThan(idxItem1S1Completed);
  });
});
