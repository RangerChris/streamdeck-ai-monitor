import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { countSessions, readSessions } from "../src/actions/live-sessions";

describe("countSessions", () => {
	it("counts total and busy sessions", () => {
		const entries = [
			{ pid: 1, status: "busy", sessionId: "a" },
			{ pid: 2, status: "idle", sessionId: "b" },
			{ pid: 3, sessionId: "c" },
			{},
		];

		expect(countSessions(entries)).toEqual({ busy: 1, total: 4 });
	});

	it("handles an empty registry", () => {
		expect(countSessions([])).toEqual({ busy: 0, total: 0 });
	});
});

describe("readSessions", () => {
	it("reads every session json in the directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sessions-"));
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "111.json"), JSON.stringify({ pid: 111, status: "busy", sessionId: "a" }));
		await writeFile(join(dir, "222.json"), JSON.stringify({ pid: 222, status: "idle", sessionId: "b" }));
		await writeFile(join(dir, "ignore.txt"), "nope");

		expect(await readSessions(dir)).toEqual({ busy: 1, total: 2 });
	});
});