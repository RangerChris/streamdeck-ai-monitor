import { mkdtemp, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { aggregateByModel, lastAssistantSummary, scanClaudeUsage, tokensByModel } from "../src/actions/claude-transcripts";

describe("lastAssistantSummary", () => {
	it("sums request context from the final assistant record", () => {
		const line = (type: string, tokens: { in: number; read: number; created: number }, ts: string): string =>
			JSON.stringify({
				type,
				timestamp: ts,
				message: { model: "glm-5.3-flash", usage: { input_tokens: tokens.in, cache_read_input_tokens: tokens.read, cache_creation_input_tokens: tokens.created } },
			});

		const content = [
			JSON.stringify({ type: "user" }),
			line("assistant", { in: 100, read: 10_000, created: 50 }, "2026-10-25T08:00:00.000Z"),
			line("assistant", { in: 200, read: 20_000, created: 100 }, "2026-10-25T09:00:00.000Z"),
			JSON.stringify({ type: "system" }),
		].join("\n");

		expect(lastAssistantSummary(content)).toEqual({ model: "glm-5.3-flash", contextTokens: 20_300 });
	});

	it("returns undefined for empty or garbage content", () => {
		expect(lastAssistantSummary("")).toBeUndefined();
		expect(lastAssistantSummary("nope\nnope")).toBeUndefined();
	});
});

describe("tokensByModel", () => {
	it("groups in+output by model and honors the cutoff", () => {
		const line = (model: string, inTokens: number, ts: string): string =>
			JSON.stringify({
				type: "assistant",
				timestamp: ts,
				sessionId: "s1",
				message: { model, usage: { input_tokens: inTokens, output_tokens: inTokens * 2, cache_read_input_tokens: 999_999 } },
			});

		const content = [line("a", 100, "2026-10-25T09:00:00Z"), line("b", 10, "2026-10-25T10:00:00Z"), line("a", 5, "2026-10-24T10:00:00Z")].join("\n");

		expect(tokensByModel(content)).toEqual(new Map([["a", 315], ["b", 30]]));
		expect(tokensByModel(content, Date.parse("2026-10-25T00:00:00Z"))).toEqual(new Map([["a", 300], ["b", 30]]));
	});
});

describe("aggregateByModel", () => {
	it("merges per-model totals across today's transcripts", async () => {
		const now = new Date();
		const dir = await mkdtemp(join(tmpdir(), "model-mix-"));
		const projects = join(dir, "projects");
		await mkdir(projects, { recursive: true });
		const assistantLine = (model: string, tokens: number, ts: Date): string =>
			JSON.stringify({
				type: "assistant",
				timestamp: ts.toISOString(),
				message: { model, usage: { input_tokens: tokens, output_tokens: tokens, cache_read_input_tokens: 5 } },
			});

		await writeFile(join(projects, "a.jsonl"), [assistantLine("glm", 100, now), assistantLine("fable", 40, now)].join("\n"));
		await writeFile(join(projects, "b.jsonl"), assistantLine("glm", 60, now));
		// Old file: outside today's window, must be ignored.
		const old = new Date(now.getTime() - 3 * 86_400_000);
		await writeFile(join(projects, "old.jsonl"), assistantLine("gpt", 999, old));

		const models = await aggregateByModel(dir, now);

		expect(models).toEqual([
			{ model: "glm", tokens: 320 },
			{ model: "fable", tokens: 80 },
		]);
	});
});

describe("tokensByModel vs scanClaudeUsage accounting", () => {
	it("keeps the same in+out convention", async () => {
		const now = new Date();
		const dir = await mkdtemp(join(tmpdir(), "mix-vs-today-"));
		const projects = join(dir, "projects");
		await mkdir(projects, { recursive: true });
		await writeFile(join(projects, "a.jsonl"), JSON.stringify({
			type: "assistant",
			timestamp: now.toISOString(),
			message: { model: "glm", usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 7 } },
		}));

		const [usage, models] = await Promise.all([scanClaudeUsage(dir, now), aggregateByModel(dir, now)]);

		expect(usage.tokensToday).toBe(140);
		expect(models[0]).toEqual({ model: "glm", tokens: 140 });
	});
});