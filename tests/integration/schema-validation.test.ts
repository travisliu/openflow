import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-09");

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

describe("JSON Schema Validation", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Valid structured output succeeds", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/schema-validation.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/schema-validation.config.yaml");

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
      "subcase=09.01"
    ]);

    expect(result.error).toBeNull();

    // Parse JSON report from stdout
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");

    const agentResult = report.agents.find((a: any) => a.id === "structured-agent");
    expect(agentResult).toBeDefined();
    
    // Assert - Agent result has ok: true
    expect(agentResult.ok).toBe(true);
    
    // Assert - Agent result has status: "succeeded"
    expect(agentResult.status).toBe("succeeded");
    
    // Assert - Agent result includes json.findings
    expect(agentResult.json).toBeDefined();
    expect(agentResult.json.findings).toEqual(["finding 1", "finding 2"]);

    const runDirs = await fs.readdir(TEMP_DIR);
    const runIdDir = runDirs.find(d => d !== "manifest.json"); // Should be the UUID dir
    const runPath = path.join(TEMP_DIR, runIdDir!);
    const agentDirPath = path.join(runPath, "agents", "structured-agent");

    // Assert - schema.json artifact exists
    const schemaPath = path.join(agentDirPath, "schema.json");
    const schemaExists = await fs.access(schemaPath).then(() => true).catch(() => false);
    expect(schemaExists).toBe(true);
    const schemaContent = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
    expect(schemaContent.properties.findings).toBeDefined();

    // Assert - normalized-result.json contains validated JSON
    const normalizedResultPath = path.join(agentDirPath, "normalized-result.json");
    const normalizedExists = await fs.access(normalizedResultPath).then(() => true).catch(() => false);
    expect(normalizedExists).toBe(true);
    const normalizedContent = JSON.parse(await fs.readFile(normalizedResultPath, "utf-8"));
    expect(normalizedContent.findings).toEqual(["finding 1", "finding 2"]);
  });

  it("Invalid structured output fails agent", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/schema-validation.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/schema-validation.config.yaml");

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
      "subcase=09.02"
    ]);

    // Parse JSON report from stdout
    const report = JSON.parse(result.stdout);
    
    expect(report.status).toBe("succeeded");

    const agentResult = report.agents.find((a: any) => a.id === "schema-fail-agent");
    expect(agentResult).toBeDefined();
    
    // Assert - Agent result has ok: false
    expect(agentResult.ok).toBe(false);
    
    // Assert - Agent result has status: "failed"
    expect(agentResult.status).toBe("failed");
    
    // Assert - Error code is SCHEMA_VALIDATION_FAILED
    expect(agentResult.error).toBeDefined();
    expect(agentResult.error.code).toBe("SCHEMA_VALIDATION_FAILED");

    // Find run directory
    const runDirs = await fs.readdir(TEMP_DIR);
    const runIdDir = runDirs.find(d => d !== "manifest.json"); 
    const runPath = path.join(TEMP_DIR, runIdDir!);
    const agentDirPath = path.join(runPath, "agents", "schema-fail-agent");

    // Assert - validation-error.json artifact exists and identifies the schema mismatch
    const validationErrorPath = path.join(agentDirPath, "validation-error.json");
    const validationErrorExists = await fs.access(validationErrorPath).then(() => true).catch(() => false);
    expect(validationErrorExists).toBe(true);
    
    const validationErrorContent = JSON.parse(await fs.readFile(validationErrorPath, "utf-8"));
    expect(Array.isArray(validationErrorContent)).toBe(true);
    expect(validationErrorContent.length).toBeGreaterThan(0);
    
    // Check if it identifies the missing "findings" property
    const hasFindingsError = validationErrorContent.some((e: any) => 
      e.params && e.params.missingProperty === "findings"
    );
    expect(hasFindingsError).toBe(true);
  });

  it("Malformed JSON fails when schema is required", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/schema-validation.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/schema-validation.config.yaml");

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
      "subcase=09.03"
    ]);

    // Parse JSON report from stdout
    const report = JSON.parse(result.stdout);
    
    expect(report.status).toBe("succeeded"); // Workflow might still succeed even if agent fails

    const agentResult = report.agents.find((a: any) => a.id === "malformed-json-agent");
    expect(agentResult).toBeDefined();
    
    // Assert - Agent result has ok: false
    expect(agentResult.ok).toBe(false);
    
    // Assert - Agent result has status: "failed"
    expect(agentResult.status).toBe("failed");
    
    // Assert - Error code is SCHEMA_VALIDATION_FAILED or similar
    expect(agentResult.error).toBeDefined();
    expect(agentResult.error.code).toBe("SCHEMA_VALIDATION_FAILED");

    // Assert - stderr or error message identifies that JSON could not be parsed
    expect(agentResult.error.message).toMatch(/JSON|parse|extract/i);
  });

  it("Plain text succeeds when no schema is required", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/schema-validation.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/schema-validation.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg",
      "subcase=09.04"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    
    expect(report.status).toBe("succeeded");

    const agentResult = report.agents.find((a: any) => a.id === "plaintext-agent");
    expect(agentResult).toBeDefined();
    
    // Assertions
    expect(agentResult.ok).toBe(true);
    expect(agentResult.status).toBe("succeeded");
    expect(agentResult.text).toBe("This is some plain text output.");
    expect(agentResult.json).toBeUndefined();
  });
});
