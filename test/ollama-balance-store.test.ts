import { afterEach, describe, expect, it, vi } from "vitest";

import { OllamaBalanceStore } from "../src/actions/ollama-balance-store";

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.OLLAMA_API_KEY;
});

const creditPlan = { included: { balance_usd: 72.5, allowance_usd: 100 } };

describe("OllamaBalanceStore", () => {
	it("shares a single fetch across callers within the minute", async () => {
		const mock = vi.fn(async () => new Response(JSON.stringify(creditPlan), { status: 200 }));
		vi.stubGlobal("fetch", mock);
		let time = 0;
		const store = new OllamaBalanceStore(() => time);
		process.env.OLLAMA_API_KEY = "k";

		const [a, b] = await Promise.all([store.get(), store.get()]);
		const c = await store.get();

		expect(mock).toHaveBeenCalledTimes(1);
		expect(a).toEqual({ status: "ok", balance: { kind: "usd", balanceUsd: 72.5, allowanceUsd: 100, purchasedUsd: 0, resetsAt: undefined } });
		expect(b).toEqual(a);
		expect(c).toEqual(a);
	});

	it("refetches when the reading turns a minute old", async () => {
		const mock = vi.fn(async () => new Response(JSON.stringify(creditPlan), { status: 200 }));
		vi.stubGlobal("fetch", mock);
		let time = 0;
		const store = new OllamaBalanceStore(() => time);
		process.env.OLLAMA_API_KEY = "k";

		await store.get();
		time += 60_000;
		await store.get();

		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("honors Retry-After after a 429, then retries", async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "7" } }))
			.mockResolvedValue(new Response(JSON.stringify(creditPlan), { status: 200 }));
		vi.stubGlobal("fetch", mock);
		let time = 0;
		const store = new OllamaBalanceStore(() => time);
		process.env.OLLAMA_API_KEY = "k";

		await expect(store.get()).resolves.toEqual({ status: "keep" });
		time += 1_000; // inside the backoff window
		await expect(store.get()).resolves.toEqual({ status: "keep" });
		time += 6_000; // backoff over — try again
		await expect(store.get()).resolves.toMatchObject({ status: "ok" });
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("reports a bad key on 401", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
		const store = new OllamaBalanceStore(() => 0);
		process.env.OLLAMA_API_KEY = "k";

		await expect(store.get()).resolves.toEqual({ status: "badkey" });
	});

	it("returns nokey without fetching when OLLAMA_API_KEY is unset", async () => {
		const mock = vi.fn();
		vi.stubGlobal("fetch", mock);

		await expect(new OllamaBalanceStore(() => 0).get()).resolves.toEqual({ status: "nokey" });
		expect(mock).not.toHaveBeenCalled();
	});
});