export const meta = {
  name: "timeout-handling",
  description: "Timeout preserves partial logs",
  phases: ["test"]
};

phase("test");

await agent({
  id: "timeout-agent",
  provider: "mock",
  prompt: "This agent should timeout",
  label: "timeout-agent",
  timeoutMs: 300
});
