import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-tc-05");

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
    await main(["node", "execflow", ...args]);
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

describe("Structured failed agent results", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Non-zero provider exit becomes AgentFailureResult", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/agent-failure.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/agent-failure.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--arg",
      "subcase=05.01"
    ]);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify manifest - workflow status might be succeeded because the script finished,
    // but the agent itself failed.
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("succeeded");

    // Verify agent artifacts
    const agentDir = path.join(runDir, "agents/failing-agent-01");
    
    // 1. stdout.log
    const stdoutLog = await fs.readFile(path.join(agentDir, "stdout.log"), "utf8");
    expect(stdoutLog).toBe("Diagnostic stdout");

    // 2. stderr.log
    const stderrLog = await fs.readFile(path.join(agentDir, "stderr.log"), "utf8");
    expect(stderrLog).toBe("Diagnostic error message");

    // 3. raw-result.json - Should be the AgentFailureResult
    const rawResult = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));
    expect(rawResult.ok).toBe(false);
    expect(rawResult.status).toBe("failed");
    expect(rawResult.exitCode).toBe(1);
    expect(rawResult.error).toBeDefined();
    expect(rawResult.error.name).toBe("ProviderProcessFailed");
    expect(rawResult.error.message).toBe("Diagnostic error message");
    expect(rawResult.error.code).toBe("PROVIDER_PROCESS_FAILED");

    // Verify report.json contains full agent details
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const agentResult = report.agents.find((a: any) => a.id === "failing-agent-01");

    expect(agentResult).toBeDefined();
    expect(agentResult.ok).toBe(false);
    expect(agentResult.status).toBe("failed");
    expect(agentResult.provider).toBe("mock");
    expect(agentResult.stdout).toBe("Diagnostic stdout");
    expect(agentResult.stderr).toBe("Diagnostic error message");
    expect(agentResult.exitCode).toBe(1);
    expect(agentResult.error.name).toBe("ProviderProcessFailed");
    expect(agentResult.error.message).toBe("Diagnostic error message");
    expect(agentResult.error.code).toBe("PROVIDER_PROCESS_FAILED");
  });

  it("Failed agent does not necessarily abort workflow", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/agent-failure.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/agent-failure.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--arg",
      "subcase=05.02"
    ]);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify manifest - workflow status should be succeeded because it finished
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("succeeded");

    // Verify report.json
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    // Both agent results appear in final report
    expect(report.agents.length).toBe(2);
    
    const failingResult = report.agents.find((a: any) => a.id === "failing-agent-02");
    const successResult = report.agents.find((a: any) => a.id === "successful-agent");

    expect(failingResult).toBeDefined();
    expect(successResult).toBeDefined();

    // Failed agent is structured as failure
    expect(failingResult.ok).toBe(false);
    expect(failingResult.status).toBe("failed");
    expect(failingResult.exitCode).toBe(1);
    expect(failingResult.stderr).toBe("Failure stderr");

    // Successful agent is structured as success
    expect(successResult.ok).toBe(true);
    expect(successResult.status).toBe("succeeded");
    expect(successResult.exitCode).toBe(0);
    expect(successResult.stdout).toBe("Success stdout");

    // Workflow exports both results
    expect(report.result).toBeDefined();
    expect(report.result.result1).toBeDefined();
    expect(report.result.result2).toBeDefined();
    expect(report.result.result1.ok).toBe(false);
    expect(report.result.result2.ok).toBe(true);
  });

  it("--fail-fast skips queued work and aborts active work", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/agent-failure.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/agent-failure.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--fail-fast",
      "--arg",
      "subcase=05.03"
    ]);

    // Assert: CLI exits non-zero (Exit code 1)
    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(1);

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify report.json
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    // Assert: Final report includes partial results (4 agents should be present)
    expect(report.agents.length).toBe(4);

    const triggerAgent = report.agents.find((a: any) => a.id === "fail-fast-trigger");
    const activeAgent = report.agents.find((a: any) => a.id === "agent-active");
    const queued1Agent = report.agents.find((a: any) => a.id === "agent-queued-1");
    const queued2Agent = report.agents.find((a: any) => a.id === "agent-queued-2");

    // Assert: First failed agent appears as failed
    expect(triggerAgent.status).toBe("failed");
    expect(triggerAgent.ok).toBe(false);

    // Assert: Queued agents become skipped
    expect(queued1Agent.status).toBe("skipped");
    expect(queued2Agent.status).toBe("skipped");

    // Assert: Running agents receive cancellation and become cancelled or failed
    expect(["cancelled", "failed"]).toContain(activeAgent.status);
  }, 10000);
});
