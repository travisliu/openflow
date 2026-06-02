export const meta = {
  name: "Workflow",
  description: "Structured failed agent results",
  phases: ["test"]
};

phase("test");

let exportVal;
if (args.subcase === "05.01") {
  await agent({
    id: "failing-agent-01",
    provider: "mock",
    prompt: "This agent should fail",
    label: "failing-agent"
  });
} else if (args.subcase === "05.02") {
  const result1 = await agent({
    id: "failing-agent-02",
    provider: "mock",
    prompt: "This agent should fail",
    label: "failing-agent"
  });

  const result2 = await agent({
    id: "successful-agent",
    provider: "mock",
    prompt: "This agent should succeed",
    label: "successful-agent"
  });
  exportVal = { result1, result2 };
} else if (args.subcase === "05.03") {
  const results = await parallel([
    () => agent({ id: "fail-fast-trigger", provider: "mock", prompt: "fail" }),
    () => agent({ id: "agent-active", provider: "mock", prompt: "wait" }),
    () => agent({ id: "agent-queued-1", provider: "mock", prompt: "queued" }),
    () => agent({ id: "agent-queued-2", provider: "mock", prompt: "queued" })
  ]);
  exportVal = { results };
}

export default exportVal;
