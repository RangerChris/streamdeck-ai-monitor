import { NeoInfobarAction, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { getBalance, OllamaApiError, OllamaBalance } from "./ollama-api";
import { gaugeColor } from "./usage-gauge";

/** How often the info bar polls, in ms; 2 min keeps it far inside the API's 10 req/min budget. */
const pollMs = 2 * 60_000;

/** Settings are not needed for the info bar. */
type InfobarSettings = Record<string, never>;

/**
 * Shows Ollama session and weekly usage as two live progress bars on the Stream Deck Neo info bar.
 */

export class OllamaInfobar extends SingletonAction<InfobarSettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.ollama.infobar";

	private timer: ReturnType<typeof setInterval> | undefined;

	/** When we may hit the API again after a 429. */
	private nextAttemptAt = 0;

	/**
	 * Assigns the layout, refreshes, and arms the poll timer.
	 */
	override onWillAppear(ev: WillAppearEvent<InfobarSettings>): void {
		if (!ev.action.isNeoInfobar()) {
			return;
		}
		const bar = ev.action as NeoInfobarAction<InfobarSettings>;

		void bar.setFeedbackLayout("layouts/ollama-infobar.json");
		void this.refresh(bar);
		clearInterval(this.timer);
		this.timer = setInterval(() => void this.refresh(bar), pollMs);
	}

	/**
	 * Tears down the poll timer.
	 */
	override onWillDisappear(_ev: WillDisappearEvent<InfobarSettings>): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	/**
	 * Fetches the balance and pushes both bars.
	 * @param bar The infobar action to update.
	 */
	private async refresh(bar: NeoInfobarAction<InfobarSettings>): Promise<void> {
		const apiKey = process.env.OLLAMA_API_KEY;
		if (!apiKey) {
			await bar.setFeedback({ sLabel: "no key", wLabel: "OLLAMA_API_KEY" });
			return;
		}
		if (Date.now() < this.nextAttemptAt) {
			return; // Backing off after a 429 — the last bars stay on screen.
		}

		try {
			const balance = await getBalance(apiKey);
			this.nextAttemptAt = 0;
			await bar.setFeedback(balanceToFeedback(balance));
		} catch (error) {
			if (error instanceof OllamaApiError) {
				if (error.retryAfterSeconds !== undefined) {
					this.nextAttemptAt = Date.now() + error.retryAfterSeconds * 1000;
				}
				await bar.setFeedback({ sLabel: error.status === 401 ? "bad key" : `err ${error.status}`, wLabel: "ollama.com" });
				streamDeck.logger.warn("OllamaInfobar: API error", error.status, error.retryAfterSeconds);
			} else {
				await bar.setFeedback({ sLabel: "offline", wLabel: "network" });
				streamDeck.logger.warn("OllamaInfobar: refresh failed", String(error));
			}
		}
	}
}

/**
 * Round a usage percentage for display to one decimal.
 * @param percent The raw percentage.
 * @returns The rounded percentage, e.g. 13.9, 5.7, 80.
 */
export function roundPercent(percent: number): number {
	return Number(percent.toFixed(1));
}

/**
 * Builds the info bar feedback payload from a balance reading: session/weekly bars on
 * subscription plans, allowance gauge with purchased credits included on credit plans.
 * @param balance The balance reading.
 * @returns Layout keys mapped to their new values.
 */
export function balanceToFeedback(balance: OllamaBalance): {
	sLabel: string;
	wLabel: string;
	session: { value: number; bar_fill_c: string };
	weekly: { value: number; bar_fill_c: string };
} {
	if (balance.kind === "percent") {
		const sessionUsed = roundPercent(100 - balance.sessionPercent);
		const weeklyUsed = roundPercent(100 - balance.weeklyPercent);
		return {
			sLabel: `SESS ${sessionUsed}%`,
			session: { value: sessionUsed, bar_fill_c: gaugeColor(sessionUsed) },
			wLabel: `WKS ${weeklyUsed}%`,
			weekly: { value: weeklyUsed, bar_fill_c: gaugeColor(weeklyUsed) },
		};
	}

	const remainingUsd = balance.balanceUsd + balance.purchasedUsd;
	const used = balance.allowanceUsd > 0 ? roundPercent(((balance.allowanceUsd - remainingUsd) / balance.allowanceUsd) * 100) : 0;
	return {
		sLabel: `BAL $${remainingUsd.toFixed(2)}`,
		session: { value: used, bar_fill_c: gaugeColor(used) },
		wLabel: `WKS $${remainingUsd.toFixed(2)}`,
		weekly: { value: used, bar_fill_c: gaugeColor(used) },
	};
}