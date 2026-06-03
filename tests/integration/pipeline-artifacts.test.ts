import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pipeline-artifacts");

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

describe("Pipeline Artifacts Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("writes pipeline, item, and stage artifacts with child-agent references", async () => {
    const workflowPath = path.join(TEMP_DIR, "success-flow.workflow.js");
    const configPath = path.join(TEMP_DIR, "success-config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = {
  name: "artifact-success",
  description: "test pipeline artifacts"
};

const items = ["A"];
const stages = [
  {
    name: "step-one",
    run: async (item, ctx) => {
      await ctx.agent({ id: ctx.agentId("agent1"), label: "agent1-label", prompt: "greet" });
      return item + "1";
    }
  }
];

await pipeline(items, stages, { strategy: "item-streaming" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      agent1-label:
        text: "hello"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    const runs = (await fs.readdir(TEMP_DIR)).filter(item => !item.endsWith(".js") && !item.endsWith(".yaml"));
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);

    const pipelinesDir = path.join(runDir, "pipelines");
    const pipelines = await fs.readdir(pipelinesDir);
    const pipelineId = pipelines[0]!;

    // 1. Verify pipeline.json
    const pipelineJsonPath = path.join(runDir, `pipelines/${pipelineId}/pipeline.json`);
    const pipelineData = JSON.parse(await fs.readFile(pipelineJsonPath, "utf8"));
    expect(pipelineData.summary.pipelineId).toBe(pipelineId);
    expect(pipelineData.summary.status).toBe("succeeded");
    expect(pipelineData.results.length).toBe(1);

    // 2. Verify item.json
    const itemJsonPath = path.join(runDir, `pipelines/${pipelineId}/items/0/item.json`);
    const itemData = JSON.parse(await fs.readFile(itemJsonPath, "utf8"));
    expect(itemData.itemIndex).toBe(0);
    expect(itemData.status).toBe("succeeded");
    expect(itemData.stages.length).toBe(1);

    // 3. Verify stage-result.json and child agent references
    const stageResultPath = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/step-one/stage-result.json`);
    const stageData = JSON.parse(await fs.readFile(stageResultPath, "utf8"));
    expect(stageData.stageName).toBe("step-one");
    expect(stageData.status).toBe("succeeded");
    expect(stageData.childAgentIds.length).toBe(1);
    const childAgentId = stageData.childAgentIds[0];
    expect(stageData.childAgentArtifacts[childAgentId]).toBeDefined();
    expect(stageData.childAgentArtifacts[childAgentId].dir).toContain("agents");
  });

  it("partial artifacts survive failures", async () => {
    const workflowPath = path.join(TEMP_DIR, "fail-flow.workflow.js");
    const configPath = path.join(TEMP_DIR, "fail-config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = {
  name: "artifact-failure",
  description: "test pipeline partial artifacts"
};

const items = ["A"];
const stages = [
  {
    name: "step-one",
    run: async (item, ctx) => {
      return item + "1";
    }
  },
  {
    name: "step-two",
    run: async (item, ctx) => {
      throw new Error("step two failed intentionally");
    }
  }
];

const results = await pipeline(items, stages, { strategy: "item-streaming" });
if (results.some(r => r.status !== "succeeded")) {
  throw new Error("Pipeline failed intentionally");
}
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Expect workflow to have failed
    const parsedReport = JSON.parse(result.stdout);
    expect(parsedReport.status).toBe("failed");

    const runs = (await fs.readdir(TEMP_DIR)).filter(item => !item.endsWith(".js") && !item.endsWith(".yaml"));
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);

    const pipelinesDir = path.join(runDir, "pipelines");
    const pipelines = await fs.readdir(pipelinesDir);
    const pipelineId = pipelines[0]!;

    // Verify stage 1 artifact was written
    const stageResultPath = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/step-one/stage-result.json`);
    const stageData = JSON.parse(await fs.readFile(stageResultPath, "utf8"));
    expect(stageData.stageName).toBe("step-one");
    expect(stageData.status).toBe("succeeded");

    // Verify stage 2 artifact was written as failed
    const stageResultPath2 = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/step-two/stage-result.json`);
    const stageData2 = JSON.parse(await fs.readFile(stageResultPath2, "utf8"));
    expect(stageData2.stageName).toBe("step-two");
    expect(stageData2.status).toBe("failed");
    expect(stageData2.error.message).toContain("step two failed intentionally");

    // Verify item artifact was written as failed
    const itemJsonPath = path.join(runDir, `pipelines/${pipelineId}/items/0/item.json`);
    const itemData = JSON.parse(await fs.readFile(itemJsonPath, "utf8"));
    expect(itemData.itemIndex).toBe(0);
    expect(itemData.status).toBe("failed");

    // Verify pipeline.json was written as failed
    const pipelineJsonPath = path.join(runDir, `pipelines/${pipelineId}/pipeline.json`);
    const pipelineData = JSON.parse(await fs.readFile(pipelineJsonPath, "utf8"));
    expect(pipelineData.summary.status).toBe("failed");
  });
});
