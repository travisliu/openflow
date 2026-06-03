import { OpenFlowError } from "./types.js";
import type { SerializedError } from "./types.js";

export function serializeError(error: unknown): SerializedError {
  const isOpenFlowError = error instanceof OpenFlowError || (error && typeof error === "object" && "code" in error && "name" in error && (error as any).name === "OpenFlowError");

  if (isOpenFlowError) {
    const execErr = error as any;
    const res: SerializedError = {
      name: execErr.name,
      message: execErr.message,
      code: execErr.code,
    };
    if (execErr.stack !== undefined) {
      res.stack = execErr.stack;
    }
    if (execErr.cause !== undefined) {
      res.cause = execErr.cause;
    }
    return res;
  }

  if (error instanceof Error || (error && typeof error === "object" && "name" in error && "message" in error)) {
    const errObj = error as any;
    const res: SerializedError = {
      name: String(errObj.name),
      message: String(errObj.message),
    };
    if (errObj.stack !== undefined) {
      res.stack = String(errObj.stack);
    }
    if (errObj.cause !== undefined) {
      res.cause = errObj.cause;
    }
    return res;
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}
