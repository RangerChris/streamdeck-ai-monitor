import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Assumed context window sizes, by model name prefix (longest prefix wins). */
const contextWindows: Array<[string, number]> = [
	["glm-5", 1_048_576],
	["glm", 200_000],
	["claude", 200_000],
];

/** Fallback window when a model is not in the table. */
export const defaultContextWindow = 200_000;

/**
 * Looks up a model's context window size.
 * @param model Model name as stored in transcripts, e.g. "claude-fable-5-1-1m:cloud" or "glm-5.3-flash".
 * @returns The context window in tokens; 1M for 1m-context variants, 200k default.
 */
export function contextWindowTokens(model: string): number {
	if (/(\[1m\]|-1m$|:1m$)/.test(model)) {
		return 1_000_000;
	}
	const lower = model.toLowerCase();
	for (const [prefix, window] of contextWindows) {
		if (lower.startsWith(prefix)) {
			return window;
		}
	}
	return defaultContextWindow;
}

/**
 * Formats a model name for a key label: drops the vendor prefix or variant noise.
 * @param model Model name, e.g. "claude-fable-5-1" or "glm-5.3-flash:cloud".
 * @returns A short display name, e.g. "Fable 5.1" or "GLM 5.3".
 */
export function shortModelName(model: string): string {
	const segments = model.replace(/:cloud$|\[1m\]$|-1m$/i, "").split("-");
	const second = segments[1] ?? "";

	if (/^\d/.test(second)) {
		// "glm-5.3-flash" style: vendor + version, no product name.
		return `${segments[0].toUpperCase()} ${second}`;
	}
	// "claude-fable-5-1" style: named product + numeric version parts.
	const version = segments.slice(2).filter((segment) => /^\d/.test(segment)).join(".");
	const capitalizedName = second.charAt(0).toUpperCase() + second.slice(1);
	return version === "" ? capitalizedName : `${capitalizedName} ${version}`;
}
/**
 * Reads the context budget the Claude Code harness enforces on this machine, if configured
 * (settings.json env.CLAUDE_CODE_MAX_CONTEXT_TOKENS). This is the denominator the harness itself uses.
 * @param claudeDir The .claude config directory.
 * @returns The configured token budget, or undefined when it is not set.
 */
export async function harnessContextTokens(claudeDir: string): Promise<number | undefined> {
	try {
		const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"));
		const value = Number(settings?.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS);
		return Number.isFinite(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}
