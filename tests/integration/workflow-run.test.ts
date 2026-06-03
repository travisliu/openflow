import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-tc-02");

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

describe("Running a valid workflow", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Basic workflow runs successfully with mock provider", async () => {
    const workflowPath = "tests/fixtures/workflows/valid-basic.workflow.js";
    const configPath = "tests/fixtures/config/mock-provider-config.yaml";
    
    const result = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    if (result.error) {
      console.error("CLI error:", result.error);
    }

    // CLI exits with code 0
    expect(result.error).toBeNull();

    // A run directory is created
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify manifest status
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("succeeded");

    // Verify report.json
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    // Final workflow status is succeeded
    expect(report.status).toBe("succeeded");

    // Final report contains workflow metadata
    expect(report.meta.name).toBe("valid-basic");
    expect(report.meta.description).toBe("A basic valid workflow for testing validation");

    // Final report contains exactly one agent result
    const agentResults = report.agents;
    expect(agentResults).toHaveLength(1);

    // Agent result has ok: true and status: "succeeded"
    const agentResult = agentResults[0];
    expect(agentResult.ok).toBe(true);
    expect(agentResult.status).toBe("succeeded");
  });

  it("Workflow phases and logs are emitted", async () => {
    const workflowPath = "tests/fixtures/workflows/phases-and-logs.workflow.js";
    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    if (result.error) {
        console.error(result.stderr);
        throw result.error;
    }
    expect(result.error).toBeNull();

    const lines = result.stdout.split("\n").filter(line => line.trim().length > 0);
    const events = lines.map(line => JSON.parse(line));

    // Assert required fields for every event
    for (const event of events) {
      expect(event).toHaveProperty("schemaVersion", "openflow.event.v1");
      expect(event).toHaveProperty("runId");
      expect(event).toHaveProperty("sequence");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("payload");
      
      expect(typeof event.sequence).toBe("number");
      expect(typeof event.timestamp).toBe("string");
      expect(typeof event.runId).toBe("string");
    }

    // Assert ordered events
    const eventTypes = events.map(e => e.type);
    
    // Check for specific events and their order
    const expectedSequence = [
      "workflow.started",
      "phase.started", // scan
      "workflow.log",   // Scanning files
      "phase.started", // review (note: phase.completed for 'scan' might also be emitted)
      "agent.queued",
      "agent.started",
      "agent.completed",
      "workflow.completed"
    ];

    // Sub-sequence check: find indices of expected events and ensure they are increasing
    let lastIndex = -1;
    for (const expectedType of expectedSequence) {
        const currentIndex = eventTypes.indexOf(expectedType, lastIndex + 1);
        expect(currentIndex, `Event ${expectedType} not found in order after index ${lastIndex}`).toBeGreaterThan(lastIndex);
        lastIndex = currentIndex;
    }

    // Assert specific payloads
    const phaseScan = events.find(e => e.type === "phase.started" && e.payload.name === "scan");
    expect(phaseScan).toBeDefined();

    const logMsg = events.find(e => e.type === "workflow.log" && e.payload.message === "Scanning files");
    expect(logMsg).toBeDefined();

    const phaseReview = events.find(e => e.type === "phase.started" && e.payload.name === "review");
    expect(phaseReview).toBeDefined();
    
    // Check that phase.completed was also emitted for 'scan'
    const phaseScanCompleted = events.find(e => e.type === "phase.completed" && e.payload.name === "scan");
    expect(phaseScanCompleted).toBeDefined();
  });
});
