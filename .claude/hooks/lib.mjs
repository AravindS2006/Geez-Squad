// Shared helpers for Geez Squad Claude Code hooks. No dependencies: hooks run on
// whatever `node` is on PATH (may be older than the project's ^22.22 runtime).
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/** Project-relative path with forward slashes, or null when outside the project. */
export function projectPath(filePath) {
  if (!filePath) return null;
  const rel = relative(projectDir, resolve(projectDir, filePath));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/** Exit 2: Claude Code blocks the tool call and shows stderr to the model. */
export function block(reason) {
  process.stderr.write(`Blocked by project hook: ${reason}\n`);
  process.exit(2);
}

/** Ask the user before the tool runs, with a reason. */
export function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Add context for the model after a tool ran. */
export function addContext(event, text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  );
  process.exit(0);
}

/** True for real secret files; templates (*.example) are allowed. */
export function isSecretFile(rel) {
  const name = rel.split('/').pop();
  if (/\.example$/.test(name)) return false;
  if (/^\.env(\..+)?$/.test(name) || name === '.envrc' || name === '.netrc') return true;
  if (/\.(pem|key|p12|pfx|har)$/.test(name)) return true;
  if (rel.startsWith('.vercel/') && name !== 'project.json') return true;
  return ['cookies.json', 'storageState.json'].includes(name);
}
