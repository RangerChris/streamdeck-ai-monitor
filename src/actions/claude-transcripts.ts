import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Usage totals from a transcript. */
export type UsageSum = {
	inputTokens: number;
	outputTokens: number;

	/** Distinct session ids seen among the assistant records. */
	sessions: number;
};

/** Aggregated Claude Code usage, keyed to calendar windows. */
export type ClaudeUsage = {
	tokensToday: number;
	tokensWeek: number;
	sessionsToday: number;
};

/** Milliseconds in a week — the rolling window for weekly totals. */
const weekMs = 7 * 24 * 60 * 60 * 1000;

/**
 * Sums assistant record usage in a transcript.
 * @param content The raw JSONL content.
 * @param sinceMs Optional epoch-ms cutoff; only records at or after it are counted.
 * @returns Input and output token totals (input+output; cache tokens excluded by default) and distinct session count.
 */
export function sumUsage(content: string, sinceMs?: number): UsageSum {
	const totals = { inputTokens: 0, outputTokens: 0 };
	const sessionIds = new Set<string>();

	for (const line of content.split(/\r?\n/)) {
		if (line.trim() === "") {
			continue;
		}
		try {
			const record: any = JSON.parse(line);
			const usage = record.type === "assistant" ? record.message?.usage : undefined;
			if (usage === undefined) {
				continue;
			}
			if (sinceMs !== undefined && !(typeof record.timestamp === "string")) {
				continue;
			}
			if (sinceMs !== undefined && Date.parse(record.timestamp) < sinceMs) {
				continue;
			}
			totals.inputTokens += usage.input_tokens ?? 0;
			totals.outputTokens += usage.output_tokens ?? 0;
			if (typeof record.sessionId === "string") {
				sessionIds.add(record.sessionId);
			}
		} catch {
			// Garbage lines (partial writes, embedded noise) shouldn't sink the whole scan.
		}
	}

	return {
		inputTokens: totals.inputTokens,
		outputTokens: totals.outputTokens,
		sessions: sessionIds.size,
	};
}

/**
 * Extracts the latest assistant record's model and its request context size.
 * @param content The raw JSONL content (a tail of a transcript is enough).
 * @returns Model name and input+cache tokens, or undefined when there is no assistant record.
 */
export function lastAssistantSummary(content: string): { model: string; contextTokens: number } | undefined {
	const lines = content.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() === "") {
			continue;
		}
		try {
			const record: any = JSON.parse(lines[i]);
			const usage = record.type === "assistant" ? record.message?.usage : undefined;
			if (usage === undefined) {
				continue;
			}
			const model = typeof record.message?.model === "string" ? record.message.model : undefined;
			if (model === undefined) {
				return undefined;
			}
			return {
				model,
				contextTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
			};
		} catch {
			// Torn final line or garbage — keep scanning backwards.
		}
	}
	return undefined;
}

/**
 * Finds the most recently modified transcript.
 * @param claudeDir The .claude config directory.
 * @returns Its path, or undefined when there are none.
 */
export async function latestTranscript(claudeDir: string): Promise<string | undefined> {
	let latest: { path: string; mtimeMs: number } | undefined;
	for (const path of await listTranscripts(join(claudeDir, "projects"))) {
		const mtimeMs = (await stat(path)).mtimeMs;
		if (latest === undefined || mtimeMs > latest.mtimeMs) {
			latest = { path, mtimeMs };
		}
	}
	return latest?.path;
}

/**
 * Walks a transcript directory (skipping subagent sidechains).
 * @param dir Directory to scan.
 * @returns Full paths of every *.jsonl file, excluding anything under a "subagents" directory.
 */
async function listTranscripts(dir: string): Promise<string[]> {
	const files: string[] = [];
	let entries;
	if (dir.endsWith("subagents")) {
		return files;
	}
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "subagents") {
			files.push(...(await listTranscripts(path)));
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			files.push(path);
		}
	}
	return files;
}

/**
 * Aggregates Claude Code usage from local transcripts and input history.
 * @param claudeDir The .claude config directory, e.g. C:\Users\you\.claude.
 * @param now The reference time; defaults to now.
 * @returns Token totals for today and the last 7 days, plus distinct sessions seen today.
 */
export async function scanClaudeUsage(claudeDir: string, now = new Date()): Promise<ClaudeUsage> {
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const weekStart = now.getTime() - weekMs;

	let tokensToday = 0;
	let tokensWeek = 0;

	for (const path of await listTranscripts(join(claudeDir, "projects"))) {
		const modified = (await stat(path)).mtimeMs;
		if (modified < weekStart) {
			continue;
		}
		const content = await readFile(path, "utf8");
		const week = sumUsage(content, weekStart);
		tokensWeek += week.inputTokens + week.outputTokens;
		if (modified >= todayStart) {
			const today = sumUsage(content, todayStart);
			tokensToday += today.inputTokens + today.outputTokens;
		}
	}

	const sessionIdToday = new Set<string>();
	try {
		const history = await readFile(join(claudeDir, "history.jsonl"), "utf8");
		for (const line of history.split(/\r?\n/)) {
			if (line.trim() === "") {
				continue;
			}
			try {
				const record: any = JSON.parse(line);
				if (typeof record.sessionId === "string" && typeof record.timestamp === "number" && record.timestamp >= todayStart) {
					sessionIdToday.add(record.sessionId);
				}
			} catch {
				// Same deal: tolerate noise.
			}
		}
	} catch {
		// No history file, no session counts.
	}

	return { tokensToday, tokensWeek, sessionsToday: sessionIdToday.size };
}

/**
 * Formats a token count in compact units for a key label.
 * @param tokens The token count.
 * @returns e.g. "987", "12k", "1.25M".
 */
export function compactTokens(tokens: number): string {
	if (tokens < 1000) {
		return `${tokens}`;
	}
	if (tokens < 1_000_000) {
		return `${Math.round(tokens / 1000)}k`;
	}
	const millions = tokens / 1_000_000;
	return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 100) / 100}M`;
}