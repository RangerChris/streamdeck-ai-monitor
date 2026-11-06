import { NeoInfobarAction, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { balanceStore } from "./ollama-balance-store";
import { OllamaBalance } from "./ollama-api";
import { gaugeColor } from "./usage-gauge";

/** Timer cadence; the shared store keeps all Ollama keys at one API request per minute. */
const pollMs = 60_000;

/** Settings are not needed for the info bar. */
type InfobarSettings = Record<string, never>;

/**
 * Shows Ollama session and weekly usage as two live progress bars on the Stream Deck Neo info bar.
 */

export class OllamaInfobar extends SingletonAction<InfobarSettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.ollama.infobar";

	private timer: ReturnType<typeof setInterval> | undefined;

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
		const reading = await balanceStore.get();

		if (reading.status === "nokey") {
			await bar.setFeedback({ sLabel: "no key", wLabel: "OLLAMA_API_KEY" });
			return;
		}
		if (reading.status === "badkey") {
			await bar.setFeedback({ sLabel: "bad key", wLabel: "ollama.com/settings/keys" });
			return;
		}
		if (reading.status === "keep") {
			return; // Backing off from a 429 or a transient error — the last bars stay on screen.
		}

		await bar.setFeedback(balanceToFeedback(reading.balance));
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
 * Human countdown until an allowance resets: days plus hours, hours plus
 * minutes, bare minutes. Empty when the reset already passed or is unknown.
 * @param resetsAt Reset time, ISO timestamp.
 * @param now The current time, epoch ms.
 * @returns e.g. "3d 2h", "3h 30m", "45m", or empty.
 */
export function resetIn(resetsAt: string | undefined, now: number): string {
	if (resetsAt === undefined) {
		return "";
	}
	const remaining = Date.parse(resetsAt) - now;
	if (!Number.isFinite(remaining) || remaining <= 0) {
		return "";
	}
	const minutes = Math.ceil(remaining / 60_000);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		const hoursPart = hours % 24;
		return hoursPart === 0 ? `${days}d` : `${days}d ${hoursPart}h`;
	}
	const minutesPart = minutes % 60;
	return minutesPart === 0 ? `${hours}h` : `${hours}h ${minutesPart}m`;
}

/**
 * Builds the info bar feedback payload from a balance reading: session/weekly bars on
 * subscription plans, allowance gauge with purchased credits included on credit plans,
 * and the countdown to the next reset underneath — both windows where known.
 * @param balance The balance reading.
 * @param now The current time, epoch ms, for the reset countdowns.
 * @returns Layout keys mapped to their new values.
 */
export function balanceToFeedback(balance: OllamaBalance, now: number = Date.now()): {
	sLabel: string;
	wLabel: string;
	session: { value: number; bar_fill_c: string };
	weekly: { value: number; bar_fill_c: string };
	reset: string;
} {
	const namedCountdown = (name: string, resetsAt: string | undefined): string => {
		const remaining = resetIn(resetsAt, now);
		return remaining === "" ? "" : `${name} in ${remaining}`;
	};

	if (balance.kind === "percent") {
		const sessionUsed = roundPercent(100 - balance.sessionPercent);
		const weeklyUsed = roundPercent(100 - balance.weeklyPercent);
		const parts = [namedCountdown("session", balance.sessionResetsAt), namedCountdown("weekly", balance.weeklyResetsAt)].filter((part) => part !== "");
		return {
			sLabel: `SESS ${sessionUsed}%`,
			session: { value: sessionUsed, bar_fill_c: gaugeColor(sessionUsed) },
			wLabel: `WKS ${weeklyUsed}%`,
			weekly: { value: weeklyUsed, bar_fill_c: gaugeColor(weeklyUsed) },
			reset: parts.join(" · "),
		};
	}

	const remainingUsd = balance.balanceUsd + balance.purchasedUsd;
	const used = balance.allowanceUsd > 0 ? roundPercent(((balance.allowanceUsd - remainingUsd) / balance.allowanceUsd) * 100) : 0;
	const allowanceCountdown = resetIn(balance.resetsAt, now);
	return {
		sLabel: `BAL $${remainingUsd.toFixed(2)}`,
		session: { value: used, bar_fill_c: gaugeColor(used) },
		wLabel: `WKS $${remainingUsd.toFixed(2)}`,
		weekly: { value: used, bar_fill_c: gaugeColor(used) },
		reset: allowanceCountdown === "" ? "" : `resets in ${allowanceCountdown}`,
	};
}
