export const meta = {
  name: "Workflow",
  description: "Workflow for testing JSONL reporter",
  phases: ["setup", "work"]
};

phase("setup");
log("Initializing setup phase");

await agent({
  id: "setup-agent",
  provider: "mock",
  prompt: "Setup everything"
});

phase("work");
log("Starting work phase");

await agent({
  id: "work-agent",
  provider: "mock",
  prompt: "Do the work"
});

log("Workflow finished");
