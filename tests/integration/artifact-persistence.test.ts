import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-07");

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("Artifact persistence", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Successful run writes required run artifacts", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";
    
    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    expect(await fs.stat(runDir)).toBeTruthy();

    expect(await fileExists(path.join(runDir, "manifest.json"))).toBe(true);
    
    const workflowInputExists = 
      (await fileExists(path.join(runDir, "workflow.input.ts"))) || 
      (await fileExists(path.join(runDir, "workflow.input.js")));
    expect(workflowInputExists).toBe(true);
    
    expect(await fileExists(path.join(runDir, "config.resolved.json"))).toBe(true);
    expect(await fileExists(path.join(runDir, "events.jsonl"))).toBe(true);
    expect(await fileExists(path.join(runDir, "report.json"))).toBe(true);

    const agentId = "review-auth";
    const agentDir = path.join(runDir, "agents", agentId);
    expect(await fs.stat(agentDir)).toBeTruthy();

    expect(await fileExists(path.join(agentDir, "prompt.txt"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "stdout.log"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "stderr.log"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "raw-result.json"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "normalized-result.json"))).toBe(true);
  });

  it("Failed run preserves artifacts", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-failure.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";
    
    await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--fail-fast"
    ]);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);
    expect(await fs.stat(runDir)).toBeTruthy();

    const manifestPath = path.join(runDir, "manifest.json");
    expect(await fileExists(manifestPath)).toBe(true);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("failed");

    const reportPath = path.join(runDir, "report.json");
    expect(await fileExists(reportPath)).toBe(true);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.status).toBe("failed");
    
    const failedAgent = report.agents.find((a: any) => a.id === "review-fail");
    expect(failedAgent).toBeDefined();
    expect(failedAgent.status).toBe("failed");

    const agentDir = path.join(runDir, "agents", "review-fail");
    expect(await fs.stat(agentDir)).toBeTruthy();
    expect(await fileExists(path.join(agentDir, "stdout.log"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "stderr.log"))).toBe(true);
    expect(await fileExists(path.join(agentDir, "raw-result.json"))).toBe(true);
    
    const stderrLog = await fs.readFile(path.join(agentDir, "stderr.log"), "utf8");
    expect(stderrLog).toContain("mock agent failure");
  });

  it("Events are appended incrementally", async () => {
    const workflowPath = "tests/fixtures/workflows/artifact-persistence.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";
    
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);
    const eventsFilePath = path.join(runDir, "events.jsonl");

    expect(await fileExists(eventsFilePath)).toBe(true);

    const eventsContent = await fs.readFile(eventsFilePath, "utf8");
    const lines = eventsContent.split("\n").filter(l => l.trim().length > 0);
    
    const events: any[] = [];
    for (const line of lines) {
      expect(() => {
        events.push(JSON.parse(line));
      }).not.toThrow();
    }

    let lastSequence = -1;
    for (const event of events) {
      expect(event.sequence).toBeGreaterThan(lastSequence);
      lastSequence = event.sequence;
    }

    const stdoutLines = result.stdout.split("\n").filter(l => l.trim().length > 0);
    expect(stdoutLines.length).toBe(lines.length);

    for (let i = 0; i < lines.length; i++) {
      expect(stdoutLines[i]).toBe(lines[i]);
    }
  });

  it("events.jsonl is still present after failed runs", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-failure.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";
    
    await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl",
      "--fail-fast"
    ]);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);
    const eventsFilePath = path.join(runDir, "events.jsonl");

    expect(await fileExists(eventsFilePath)).toBe(true);

    const eventsContent = await fs.readFile(eventsFilePath, "utf8");
    const lines = eventsContent.split("\n").filter(l => l.trim().length > 0);
    const events = lines.map(l => JSON.parse(l));

    const types = events.map(e => e.type);
    expect(types).toContain("workflow.started");
    expect(types).toContain("workflow.failed");
  });
});
