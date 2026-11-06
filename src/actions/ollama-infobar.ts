import { NeoInfobarAction, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { balanceStore } from "./ollama-balance-store";
import { OllamaBalance } from "./ollama-api";
import { gaugeColor } from "./usage-gauge";

/** Timer cadence; the shared store keeps all Ollama keys at one API request per minute. */
const pollMs = 60_000;

/** Redraw cadence of the next-update countdown line, for a smooth shrink. */
const lineTickMs = 250;

/** Settings are not needed for the info bar. */
type InfobarSettings = Record<string, never>;

/**
 * The countdown line's value: full when the update is due, shrinking to 0 as
 * the poll approaches, clamped to 0..100 with a tenth's precision.
 * @param nextUpdateAt When the next update is due, epoch ms.
 * @param now The current time, epoch ms.
 * @param periodMs Countdown period, ms.
 */
export function nextLinePercent(nextUpdateAt: number, now: number, periodMs: number): number {
	const fraction = (nextUpdateAt - now) / periodMs;
	return Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10;
}

/**
 * Shows Ollama session and weekly usage as two live progress bars on the Stream Deck Neo info bar.
 */

export class OllamaInfobar extends SingletonAction<InfobarSettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.ollama.infobar";

	private timer: ReturnType<typeof setInterval> | undefined;
	private lineTimer: ReturnType<typeof setInterval> | undefined;

	/** When the next fresh reading is due; 0 means the countdown is idle. */
	private nextUpdateAt = 0;

	/**
	 * Assigns the layout, refreshes, and arms the poll and countdown timers.
	 */
	override onWillAppear(ev: WillAppearEvent<InfobarSettings>): void {
		if (!ev.action.isNeoInfobar()) {
			return;
		}
		const bar = ev.action as NeoInfobarAction<InfobarSettings>;

		void bar.setFeedbackLayout("layouts/ollama-infobar.json");
		void this.refresh(bar);
		clearInterval(this.timer);
		clearInterval(this.lineTimer);
		this.timer = setInterval(() => void this.refresh(bar), pollMs);
		this.lineTimer = setInterval(() => {
			if (this.nextUpdateAt === 0) {
				return;
			}
			void bar.setFeedback({ next: nextLinePercent(this.nextUpdateAt, Date.now(), pollMs) });
		}, lineTickMs);
	}

	/**
	 * Tears down the poll and countdown timers.
	 */
	override onWillDisappear(_ev: WillDisappearEvent<InfobarSettings>): void {
		clearInterval(this.timer);
		clearInterval(this.lineTimer);
		this.timer = undefined;
		this.lineTimer = undefined;
		this.nextUpdateAt = 0;
	}

	/**
	 * Fetches the balance, pushes both bars, and restarts the countdown line on
	 * fresh data. A "keep" reading holds the bars and lets the line shrink to 0
	 * until real data arrives.
	 * @param bar The infobar action to update.
	 */
	private async refresh(bar: NeoInfobarAction<InfobarSettings>): Promise<void> {
		const reading = await balanceStore.get();

		if (reading.status === "nokey") {
			this.nextUpdateAt = 0;
			await bar.setFeedback({ sLabel: "no key", wLabel: "OLLAMA_API_KEY", next: 100 });
			return;
		}
		if (reading.status === "badkey") {
			this.nextUpdateAt = 0;
			await bar.setFeedback({ sLabel: "bad key", wLabel: "ollama.com/settings/keys", next: 100 });
			return;
		}
		if (reading.status === "keep") {
			return; // Backing off from a 429 or a transient error — the last bars and the shrinking line stay on screen.
		}

		this.nextUpdateAt = Date.now() + pollMs;
		await bar.setFeedback({ ...balanceToFeedback(reading.balance), next: 100 });
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
