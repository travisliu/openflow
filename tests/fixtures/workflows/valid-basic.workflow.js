export const meta = {
  name: "valid-basic",
  description: "A basic valid workflow for testing validation"
};

phase("init");
log("Starting");
const result = await agent({ prompt: "task 1" });

export default { result };
