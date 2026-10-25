import { describe, expect, it } from "vitest";

import { balanceToFeedback, roundPercent } from "../src/actions/ollama-infobar";
import { OllamaBalance } from "../src/actions/ollama-api";

describe("roundPercent", () => {
	it("keeps one decimal under ten and whole numbers above", () => {
		expect(roundPercent(5.67)).toBe(5.7);
		expect(roundPercent(13.93)).toBe(13.9);
		expect(roundPercent(0.04)).toBe(0);
	});
});

describe("balanceToFeedback", () => {
	it("maps session and weekly usage to bars and labels", () => {
		const balance: OllamaBalance = {
			kind: "percent",
			sessionPercent: 86.07,
			weeklyPercent: 94.33,
			resetsAt: "2026-10-25T11:00:00Z",
		};

		expect(balanceToFeedback(balance)).toEqual({
			sLabel: "SESS 13.9%",
			session: { bar_fill_c: "#2ea043", value: 13.9 },
			wLabel: "WKS 5.7%",
			weekly: { bar_fill_c: "#2ea043", value: 5.7 },
		});
	});

	it("colors the bars by usage thresholds", () => {
		const amber: OllamaBalance = { kind: "percent", sessionPercent: 39, weeklyPercent: 20 };
		const red: OllamaBalance = { kind: "percent", sessionPercent: 10, weeklyPercent: 10 };

		const amberFeedback = balanceToFeedback(amber);
		expect(amberFeedback.session).toMatchObject({ value: 61, bar_fill_c: "#e6b45a" });
		expect(amberFeedback.weekly).toMatchObject({ value: 80, bar_fill_c: "#e6b45a" });

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
		});
	});
});