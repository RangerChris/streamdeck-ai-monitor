import { describe, expect, it } from "vitest";

import { lastAssistantSummary } from "../src/actions/claude-transcripts";

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