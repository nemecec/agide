import { hostTools } from '../isolation/hostTools';

export interface LoginStatus {
  readonly signedIn: boolean;
  /** `authMethod` of the CLI's JSON output. Nothing else of the output is read. */
  readonly authMethod?: string;
}

export type RunStatus = (binary: string, args: string[], env: Record<string, string>) => Promise<{ exitCode: number; stdout: string }>;

const runWithExecFile: RunStatus = (binary, args, env) =>
  new Promise((resolve) => {
    hostTools().execFile(binary, args, { env, timeout: 15_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ exitCode: code, stdout: String(stdout) });
    });
  });

/**
 * Whether the profile's Claude configuration directory holds a login: `claude auth status` exits 0 when signed
 * in. The app reads the exit code and `authMethod` only, not the account fields (design 0022 section 4).
 */
export async function checkClaudeLogin(binary: string, env: Record<string, string>, run: RunStatus = runWithExecFile): Promise<LoginStatus> {
  const { exitCode, stdout } = await run(binary, ['auth', 'status'], env);
  if (exitCode !== 0) return { signedIn: false };
  try {
    const parsed: unknown = JSON.parse(stdout);
    const method = typeof parsed === 'object' && parsed !== null ? (parsed as { authMethod?: unknown }).authMethod : undefined;
    return typeof method === 'string' ? { signedIn: true, authMethod: method } : { signedIn: true };
  } catch {
    return { signedIn: true };
  }
}
