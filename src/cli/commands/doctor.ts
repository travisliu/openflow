import { ErrorCode } from "../../errors/codes.js";
import { ExecflowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import type { ProviderHealthChecker, DoctorResult } from "../../doctors/public.js";
import { createDefaultProviderRegistry } from "../../agents/registry.js";

export interface DoctorCommandDeps {
  providerHealthChecker: ProviderHealthChecker;
}

export interface DoctorCommandInput {
  rawOptions: any;
  deps?: Partial<DoctorCommandDeps>;
}

const defaultProviderHealthChecker: ProviderHealthChecker = {
  async checkAll(config): Promise<DoctorResult> {
    const registry = createDefaultProviderRegistry({ config: { ...config, cliArgs: {} } });
    const providers = [];
    let ok = true;
    for (const adapter of registry.list()) {
      const health = adapter.checkHealth
        ? await adapter.checkHealth()
        : { provider: adapter.name, available: true, message: "available" };
      providers.push({
        provider: health.provider,
        ok: health.available,
        message: health.message || (health.available ? "available" : "unavailable")
      });
      if (!health.available) {
        ok = false;
      }
    }
    return { ok, providers };
  }
};

export async function doctorCommand(input: DoctorCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  // Load config
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      verbose: rawOptions.verbose !== undefined ? !!rawOptions.verbose : undefined
    }
  });

  const checker = input.deps?.providerHealthChecker ?? defaultProviderHealthChecker;
  const result = await checker.checkAll(config);

  for (const provider of result.providers) {
    const symbol = provider.ok ? "✓" : "✕";
    console.log(
      `${symbol} ${provider.provider.padEnd(8)} ${provider.ok ? "available" : "unavailable"}${
        provider.message ? `: ${provider.message}` : ""
      }`
    );
  }

  if (!result.ok) {
    const failedList = result.providers
      .filter((p) => !p.ok)
      .map((p) => p.provider)
      .join(", ");
    throw new ExecflowError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Provider check failed: ${failedList} is unavailable.`
    );
  }
}
