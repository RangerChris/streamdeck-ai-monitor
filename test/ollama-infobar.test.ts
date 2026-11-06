import { describe, expect, it } from "vitest";

import { balanceToFeedback, nextLinePercent, resetIn, roundPercent } from "../src/actions/ollama-infobar";
import { OllamaBalance } from "../src/actions/ollama-api";

describe("roundPercent", () => {
	it("keeps one decimal under ten and whole numbers above", () => {
		expect(roundPercent(5.67)).toBe(5.7);
		expect(roundPercent(13.93)).toBe(13.9);
		expect(roundPercent(0.04)).toBe(0);
	});
});

describe("nextLinePercent", () => {
	const period = 60_000;

	it("is full at schedule time and halfway mid-period", () => {
		const now = Date.now();
		expect(nextLinePercent(now + period, now, period)).toBe(100);
		expect(nextLinePercent(now + period / 2, now, period)).toBe(50);
	});

	it("never goes negative or above full", () => {
		const now = Date.now();
		expect(nextLinePercent(now - 5_000, now, period)).toBe(0);
		expect(nextLinePercent(now + period * 2, now, period)).toBe(100);
	});

	it("keeps a fractional precision for a smooth shrink", () => {
		const now = 1_000_000;
		expect(nextLinePercent(now + 1_000, now, 60_000)).toBe(1.7);
	});
});

describe("resetIn", () => {
	const now = Date.UTC(2026, 10, 6, 12, 0);

	it("formats days plus hours, hours plus minutes, then bare minutes", () => {
		expect(resetIn("2026-11-09T14:00:00Z", now)).toBe("3d 2h");
		expect(resetIn("2026-11-06T15:30:00Z", now)).toBe("3h 30m");
		expect(resetIn("2026-11-06T12:45:00Z", now)).toBe("45m");
	});

	it("returns empty for missing, past, or unparseable timestamps", () => {
		expect(resetIn(undefined, now)).toBe("");
		expect(resetIn("banana", now)).toBe("");
		expect(resetIn("2026-11-05T00:00:00Z", now)).toBe("");
	});
});

describe("balanceToFeedback", () => {
	it("maps session and weekly usage to bars, labels, and both reset countdowns", () => {
		const balance: OllamaBalance = {
			kind: "percent",
			sessionPercent: 86.07,
			weeklyPercent: 94.33,
			sessionResetsAt: "2026-10-25T19:00:00Z",
			weeklyResetsAt: "2026-10-28T11:00:00Z",
		};
		const now = Date.UTC(2026, 9, 25, 8, 0);

		expect(balanceToFeedback(balance, now)).toEqual({
			sLabel: "SESS 13.9%",
			session: { bar_fill_c: "#2ea043", value: 13.9 },
			wLabel: "WKS 5.7%",
			weekly: { bar_fill_c: "#2ea043", value: 5.7 },
			reset: "session in 11h · weekly in 3d 3h",
		});
	});

	it("joins only the windows it knows reset times for", () => {
		const balance: OllamaBalance = { kind: "percent", sessionPercent: 50, weeklyPercent: 40, sessionResetsAt: "2026-10-25T12:15:00Z" };
		expect(balanceToFeedback(balance, Date.UTC(2026, 9, 25, 8, 0)).reset).toBe("session in 4h 15m");

		const weeklyOnly: OllamaBalance = { kind: "percent", sessionPercent: 50, weeklyPercent: 40, weeklyResetsAt: "2026-10-28T00:00:00Z" };
		expect(balanceToFeedback(weeklyOnly, Date.UTC(2026, 9, 25, 8, 0)).reset).toBe("weekly in 2d 16h");

		expect(balanceToFeedback({ kind: "percent", sessionPercent: 50, weeklyPercent: 40 }).reset).toBe("");
	});

	it("colors the bars by usage thresholds", () => {
		const amber: OllamaBalance = { kind: "percent", sessionPercent: 39, weeklyPercent: 20 };
		const red: OllamaBalance = { kind: "percent", sessionPercent: 10, weeklyPercent: 10 };

		const amberFeedback = balanceToFeedback(amber);
		expect(amberFeedback.session).toMatchObject({ value: 61, bar_fill_c: "#e6b45a" });
		expect(amberFeedback.weekly).toMatchObject({ value: 80, bar_fill_c: "#e6b45a" });
		expect(amberFeedback.reset).toBe("");

		const redFeedback = balanceToFeedback(red);
		expect(redFeedback.session).toMatchObject({ value: 90, bar_fill_c: "#d0342c" });
	});

	it("falls back to allowance bars for credit-balance plans", () => {
		const balance: OllamaBalance = { kind: "usd", balanceUsd: 20, allowanceUsd: 100, purchasedUsd: 0 };

		expect(balanceToFeedback(balance)).toEqual({
			sLabel: "BAL $20.00",
			session: { bar_fill_c: "#e6b45a", value: 80 },
			wLabel: "WKS $20.00",
			weekly: { bar_fill_c: "#e6b45a", value: 80 },
			reset: "",
		});
	});

	it("counts down the allowance period on credit-balance plans", () => {
		const balance: OllamaBalance = { kind: "usd", balanceUsd: 20, allowanceUsd: 100, purchasedUsd: 0, resetsAt: "2026-10-27T00:00:00Z" };
		expect(balanceToFeedback(balance, Date.UTC(2026, 9, 26, 10, 0)).reset).toBe("resets in 14h");
	});
});