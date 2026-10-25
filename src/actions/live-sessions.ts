import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Session counts from the live Claude registry. */
export type SessionCounts = {
	/** How many sessions are registered. */
	total: number;

	/** How many of those are actively busy. */
	busy: number;
};

/**
 * Counts registered and busy sessions among registry entries.
 * @param entries The parsed session registry entries.
 * @returns Total entries and how many carry status "busy".
 */
export function countSessions(entries: { status?: string }[]): SessionCounts {
	return { total: entries.length, busy: entries.filter((entry) => entry.status === "busy").length };
}

/**
 * Reads the live Claude Code session registry.
 * @param sessionsDir The .claude/sessions directory.
 * @returns Total and busy session counts; zero when the directory is missing.
 */
export async function readSessions(sessionsDir: string): Promise<SessionCounts> {
	const entries: { status?: string }[] = [];
	for (const name of await readdir(sessionsDir).catch(() => [])) {
		if (!name.endsWith(".json")) {
			continue;
		}
		try {
			entries.push(JSON.parse(await readFile(join(sessionsDir, name), "utf8")));
		} catch {
			// Half-written entries shouldn't break the poll.
		}
	}
	return countSessions(entries);
}