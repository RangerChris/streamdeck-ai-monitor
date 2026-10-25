import { describe, expect, it } from "vitest";

import { contextWindowTokens, shortModelName } from "../src/actions/context-limits";

describe("contextWindowTokens", () => {
	it("looks up by stripped model name", () => {
		expect(contextWindowTokens("glm-5.3-flash:cloud")).toBe(1_048_576);
		expect(contextWindowTokens("glm-5.2")).toBe(1_048_576);
		expect(contextWindowTokens("claude-fable-5-1")).toBe(200_000);
		expect(contextWindowTokens("claude-sonnet-5-5")).toBe(200_000);
	});

	it("honors the 1m context suffixes", () => {
		expect(contextWindowTokens("claude-fable-5-1-1m")).toBe(1_000_000);
		expect(contextWindowTokens("claude-fable-5-1[1m]")).toBe(1_000_000);
	});

	it("defaults to 200k for unknown models", () => {
		expect(contextWindowTokens("gpt-9000")).toBe(200_000);
	});
});

describe("harnessContextTokens", () => {
	it("reads the harness's enforced context budget from settings.json env", async () => {
		const { harnessContextTokens } = await import("../src/actions/context-limits");
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const dir = await mkdtemp(join(tmpdir(), "ctx-"));
		await writeFile(join(dir, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1048576" } }));
		expect(await harnessContextTokens(dir)).toBe(1_048_576);

		await writeFile(join(dir, "settings.json"), JSON.stringify({ env: { OTHER: "x" } }));
		expect(await harnessContextTokens(dir)).toBeUndefined();

		await writeFile(join(dir, "settings.json"), "not json at all");
		expect(await harnessContextTokens(dir)).toBeUndefined();
	});
});

describe("shortModelName", () => {
	it("drops the vendor prefix and cloud suffixes", () => {
		expect(shortModelName("claude-fable-5-1")).toBe("Fable 5.1");
		expect(shortModelName("glm-5.3-flash")).toBe("GLM 5.3");
		expect(shortModelName("claude-haiku-5-5[1m]")).toBe("Haiku 5.5");
	});

	it("keeps flash variants readable", () => {
		expect(shortModelName("glm-5.3-flash")).toBe("GLM 5.3");
	});
});