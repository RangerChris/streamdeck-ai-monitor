import { mkdtemp, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compactTokens, scanClaudeUsage, sumUsage } from "../src/actions/claude-transcripts";

let daysAgoAt: (days: number) => Date;

beforeEach(() => {
	const now = new Date();
	daysAgoAt = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
});

describe("sumUsage", () => {
	it("sums assistant records and skips everything else", () => {
		const line = (tokens: number, ts: string, session = "s1", type = "assistant"): string =>
			JSON.stringify({
				type,
				timestamp: ts,
				sessionId: session,
				message: { model: "m", usage: { input_tokens: tokens, output_tokens: tokens } },
			});

		const content = [
			JSON.stringify({ type: "user", message: { role: "user" } }),
			line(100, "2026-10-25T08:00:00.000Z"),
			JSON.stringify({ type: "system" }),
			line(200, "2026-10-25T09:00:00.000Z", "s2"),
			"not json at all",
			line(10, "2026-10-25T10:00:00.000Z", "s3", "system"),
		].join("\n");

		expect(sumUsage(content)).toEqual({ inputTokens: 300, outputTokens: 300, sessions: 2 });
	});
});

describe("scanClaudeUsage", () => {
	it("aggregates today and this week from projects and history", async () => {
		const now = new Date();
		const claudeDir = await mkdtemp(join(tmpdir(), "claude-usage-"));
		const assistantLine = (inTokens: number, ts: Date, session: string): string =>
			JSON.stringify({
				type: "assistant",
				timestamp: ts.toISOString(),
				sessionId: session,
				message: { model: "m", usage: { input_tokens: inTokens, output_tokens: inTokens, cache_read_input_tokens: 999_999 } },
			});

		const projects = join(claudeDir, "projects");
		await mkdir(join(projects, "alpha"), { recursive: true });
		await mkdir(join(projects, "alpha", "subagents"), { recursive: true });
		await writeFile(join(projects, "alpha", "today.jsonl"), [assistantLine(1000, now, "t1"), assistantLine(2000, now, "t2")].join("\n"));
		await writeFile(join(projects, "alpha", "subagents", "agent-x.jsonl"), assistantLine(500, now, "side"));
		await writeFile(join(projects, "alpha", "three-days.jsonl"), assistantLine(40, daysAgoAt(3), "old"));

		const history = [1, 2, 3].map((i) => JSON.stringify({ display: "p", timestamp: now.getTime(), sessionId: `live${i}` }));
		history.push(JSON.stringify({ display: "p", timestamp: daysAgoAt(2).getTime(), sessionId: "yesterday" }));
		await writeFile(join(claudeDir, "history.jsonl"), history.join("\n"));
		await writeFile(join(projects, "alpha", "ancient.jsonl"), assistantLine(1, daysAgoAt(12), "gone"));

		// Set mtimes so the scanner's freshness filter matches the timestamps baked into the content.
		await utimes(join(projects, "alpha", "today.jsonl"), now, now);
		await utimes(join(projects, "alpha", "subagents", "agent-x.jsonl"), now, now);
		await utimes(join(projects, "alpha", "three-days.jsonl"), daysAgoAt(3), daysAgoAt(3));
		await utimes(join(projects, "alpha", "ancient.jsonl"), daysAgoAt(12), daysAgoAt(12));

		const usage = await scanClaudeUsage(claudeDir, now);

		expect(usage).toEqual({ tokensToday: 6000, tokensWeek: 6080, sessionsToday: 3 });
	});
});

describe("compactTokens", () => {
	it("picks a human-friendly unit", () => {
		expect(compactTokens(987)).toBe("987");
		expect(compactTokens(12_300)).toBe("12k");
		expect(compactTokens(1_250_000)).toBe("1.25M");
		expect(compactTokens(48_900_000)).toBe("49M");
	});
});