export const meta = {
  name: "artifact-persistence",
  description: "Workflow for testing incremental event appending",
  phases: ["phase1", "phase2"]
};

phase("phase1");
await agent({ id: "agent1", provider: "mock", prompt: "prompt1" });

phase("phase2");
await parallel([
  () => agent({ id: "agent2", provider: "mock", prompt: "prompt2" }),
  () => agent({ id: "agent3", provider: "mock", prompt: "prompt3" })
]);
