import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pipeline-reporters");

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

describe("Pipeline Reporters Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("JSON reporter contains pipeline summary information", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/pipeline-item-streaming.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();
    const stdout = result.stdout.trim();
    const parsed = JSON.parse(stdout);

    expect(parsed.status).toBe("succeeded");
    expect(parsed.pipelines).toBeDefined();
    expect(parsed.pipelines.length).toBe(1);

    const pipelineSummary = parsed.pipelines[0];
    expect(typeof pipelineSummary.pipelineId).toBe("string");
    expect(pipelineSummary.pipelineId.length).toBeGreaterThan(0);
    expect(pipelineSummary.strategy).toBe("item-streaming");
    expect(pipelineSummary.status).toBe("succeeded");
    expect(pipelineSummary.itemCount).toBe(2);
    expect(pipelineSummary.succeededCount).toBe(2);
    expect(pipelineSummary.stageNames).toEqual(["stage1", "stage2"]);
    expect(pipelineSummary.artifactPath).toContain(pipelineSummary.pipelineId);

    // Assert that large value details (like values inside results) are not duplicated inside the summary itself
    expect(pipelineSummary.results).toBeUndefined();
  });

  it("JSONL reporter outputs all pipeline and stage/item lifecycle events", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/pipeline-item-streaming.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    expect(result.error).toBeNull();
    const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
    const events = lines.map((line) => JSON.parse(line));

    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain("pipeline.started");
    expect(eventTypes).toContain("pipeline.item.started");
    expect(eventTypes).toContain("pipeline.stage.started");
    expect(eventTypes).toContain("pipeline.stage.completed");
    expect(eventTypes).toContain("pipeline.item.completed");
    expect(eventTypes).toContain("pipeline.completed");

    // Verify ordering and sequence numbers
    const sequences = events.map((e) => e.sequence as number);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });

  it("Pretty reporter formats pipeline details clearly", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/pipeline-item-streaming.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Pipeline ");
    expect(result.stdout).toContain("started [strategy: item-streaming");
    expect(result.stdout).toContain("completed successfully");
    expect(result.stdout).toContain("Artifacts:");
  });
});
