export const meta = {
  name: "Workflow",
  description: "Workflow with phases and logs",
  phases: ["scan", "review"]
};

phase("scan");
log("Scanning files");

phase("review");
await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Review src/auth.ts"
});
