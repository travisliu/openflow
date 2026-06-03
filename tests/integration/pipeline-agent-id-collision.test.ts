import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pipeline-agent-id-collision");

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

describe("Pipeline Agent ID Collision Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("handles a stage making two sequential and parallel child-agent calls without explicit IDs and verifies unique IDs in artifacts", async () => {
    const workflowPath = path.join(TEMP_DIR, "id-collision-flow.workflow.js");
    const configPath = path.join(TEMP_DIR, "id-collision-config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = {
  name: "id-collision-pipeline",
  description: "Test pipeline agent ID collisions"
};

const items = ["taskA"];
const stages = [
  {
    name: "sequential-stage",
    run: async (item, ctx) => {
      const r1 = await ctx.agent({
        prompt: "seq prompt 1"
      });
      const r2 = await ctx.agent({
        prompt: "seq prompt 2"
      });
      return r1.text + " & " + r2.text;
    }
  },
  {
    name: "parallel-stage",
    run: async (item, ctx) => {
      const [r1, r2] = await parallel([
        () => ctx.agent({ prompt: "parallel prompt 1" }),
        () => ctx.agent({ prompt: "parallel prompt 2" })
      ]);
      return r1.text + " & " + r2.text;
    }
  }
];

await pipeline(items, stages, { strategy: "stage-barrier" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      pipeline-1-item-0-sequential-stage-1:
        text: "seq-response-1"
      pipeline-1-item-0-sequential-stage-2:
        text: "seq-response-2"
      pipeline-1-item-0-parallel-stage-1:
        text: "parallel-response-1"
      pipeline-1-item-0-parallel-stage-2:
        text: "parallel-response-2"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.pipelines[0].succeededCount).toBe(1);

    const runs = (await fs.readdir(TEMP_DIR)).filter(item => !item.endsWith(".js") && !item.endsWith(".yaml"));
    const runDir = path.join(TEMP_DIR, runs[0]!);

    const pipelinesDir = path.join(runDir, "pipelines");
    const pipelines = await fs.readdir(pipelinesDir);
    const pipelineId = pipelines[0]!;

    // Assert stage 1 output and child agent IDs
    const stage1Path = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/sequential-stage/stage-result.json`);
    const stage1Data = JSON.parse(await fs.readFile(stage1Path, "utf8"));
    expect(stage1Data.status).toBe("succeeded");
    expect(stage1Data.value).toBe("seq-response-1 & seq-response-2");
    expect(stage1Data.childAgentIds).toHaveLength(2);
    expect(stage1Data.childAgentIds[0]).toBe("pipeline-1-item-0-sequential-stage-1");
    expect(stage1Data.childAgentIds[1]).toBe("pipeline-1-item-0-sequential-stage-2");
    expect(stage1Data.childAgentArtifacts["pipeline-1-item-0-sequential-stage-1"]).toBeDefined();
    expect(stage1Data.childAgentArtifacts["pipeline-1-item-0-sequential-stage-2"]).toBeDefined();

    // Assert stage 2 output and child agent IDs
    const stage2Path = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/parallel-stage/stage-result.json`);
    const stage2Data = JSON.parse(await fs.readFile(stage2Path, "utf8"));
    expect(stage2Data.status).toBe("succeeded");
    expect(stage2Data.value).toBe("parallel-response-1 & parallel-response-2");
    expect(stage2Data.childAgentIds).toHaveLength(2);
    expect(stage2Data.childAgentIds).toContain("pipeline-1-item-0-parallel-stage-1");
    expect(stage2Data.childAgentIds).toContain("pipeline-1-item-0-parallel-stage-2");
    expect(stage2Data.childAgentArtifacts["pipeline-1-item-0-parallel-stage-1"]).toBeDefined();
    expect(stage2Data.childAgentArtifacts["pipeline-1-item-0-parallel-stage-2"]).toBeDefined();
  });
});
