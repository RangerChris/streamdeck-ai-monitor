import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { failureColor, failureFrames, svgDataUri } from "./animations";
import { getBalance, OllamaApiError, OllamaBalance } from "./ollama-api";
import { createKeyAnimator, KeyAnimator } from "./key-animator";
import { PollingAction } from "./polling-action";
import { gaugeColor, gaugeSvg } from "./usage-gauge";

/**
 * Shows remaining Ollama credit as a ring gauge, refreshed on a fixed cadence and on press.
 */

export class OllamaBalanceAction extends PollingAction<OllamaBalanceSettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.ollama.balance";

	/**
	 * 5 min cadence: usage numbers move slowly, and the API's 10 req/min budget is then spent on nothing.
	 */
	private static readonly pollMs = 5 * 60_000;

	/** When we may hit the API again per key, honoring Retry-After from a 429. */
	private readonly nextAttemptAt = new Map<string, number>();

	/** Last shown usage percent per key, so the red flash only plays when a threshold is newly crossed. */
	private readonly lastUsedPercent = new Map<string, number>();

	/** Red-flash animators per key. */
	private readonly animators = new Map<string, KeyAnimator>();

	protected override get pollMs(): number {
		return OllamaBalanceAction.pollMs;
	}

	protected override async refresh(action: KeyAction<OllamaBalanceSettings>): Promise<void> {
		const apiKey = process.env.OLLAMA_API_KEY;

		if (!apiKey) {
			await action.setImage(svgDataUri(gaugeSvg(100, "OLLAMA_API_KEY", failureColor, "setx it, restart app")));
			return;
		}

		const nextAttempt = this.nextAttemptAt.get(action.id);
		if (nextAttempt !== undefined && Date.now() < nextAttempt) {
			return; // Backing off from a 429 — keep the last reading on screen.
		}

		try {
			const balance = await getBalance(apiKey);
			this.nextAttemptAt.delete(action.id);
			await this.render(action, balance);
		} catch (error) {
			if (error instanceof OllamaApiError) {
				if (error.retryAfterSeconds !== undefined) {
					this.nextAttemptAt.set(action.id, Date.now() + error.retryAfterSeconds * 1000);
				}
				if (error.status === 401) {
					await action.setImage(svgDataUri(gaugeSvg(100, "bad key", failureColor, "ollama.com/settings/keys")));
				}
				streamDeck.logger.warn("OllamaBalance: API error", error.status, error.retryAfterSeconds);
			} else {
				streamDeck.logger.warn("OllamaBalance: refresh failed", String(error));
			}
		}
	}

	/**
	 * Draws the gauge for a fresh balance reading.
	 * @param action The key to update.
	 * @param balance The normalized balance.
	 */
	private async render(action: KeyAction<OllamaBalanceSettings>, balance: OllamaBalance): Promise<void> {
		const settings = await action.getSettings();
		const warnPercent = settings.warnPercent ?? 60;
		const lowPercent = settings.lowPercent ?? 85;

		const used = usedPercent(balance);
		// Everything on this key reads the same direction: ring, number, and color are all "how much I've used".
		const label = balance.kind === "usd" ? `$${Math.max(0, balance.allowanceUsd - balance.balanceUsd).toFixed(2)}` : `${Math.round(used * 10) / 10}%`;
		const sublabel = balance.kind === "usd" ? `of $${balance.allowanceUsd.toFixed(0)}` : formatResetsIn(balance.resetsAt);

		await action.setImage(svgDataUri(gaugeSvg(used, label, gaugeColor(used, warnPercent, lowPercent), sublabel)));

		const previous = this.lastUsedPercent.get(action.id);
		if ((previous ?? 0) < lowPercent && used >= lowPercent) {
			this.animator(action).play(failureFrames());
		}
		this.lastUsedPercent.set(action.id, used);
	}

	/**
	 * Gets or creates the animation driver for an instance.
	 * @param action The key to animate.
	 * @returns The instance's animator, bound to the key's image.
	 */
	private animator(action: KeyAction<OllamaBalanceSettings>): KeyAnimator {
		let animator = this.animators.get(action.id);
		if (animator === undefined) {
			animator = createKeyAnimator((image) => void action.setImage(image && svgDataUri(image)));
			this.animators.set(action.id, animator);
		}
		return animator;
	}
}

/**
 * Computes usage as a percentage of plan capacity.
 * @param balance The balance reading.
 * @returns Percent used, 0-100; zero when the plan has no allowance to measure against.
 */
export function usedPercent(balance: OllamaBalance): number {
	if (balance.kind === "usd") {
		return balance.allowanceUsd > 0 ? clampPercent(((balance.allowanceUsd - balance.balanceUsd) / balance.allowanceUsd) * 100) : 0;
	}
	return clampPercent(100 - balance.weeklyPercent);
}

/**
 * Formats the time until the allowance resets.
 * @param iso The reset timestamp, if known.
 * @returns e.g. "3h 05m", "in 40m" style is skipped; empty string when unknown or past.
 */
export function formatResetsIn(iso: string | undefined, now = new Date()): string {
	if (iso === undefined) {
		return "";
	}
	const remainingMs = Date.parse(iso) - now.getTime();
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
		return "";
	}
	const minutes = Math.floor(remainingMs / 60000);
	const m = minutes % 60;
	const h = Math.floor(minutes / 60);
	return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Settings for {@link OllamaBalance}, managed via the Property Inspector.
 */
type OllamaBalanceSettings = {
	/** Usage percent where the gauge turns amber; defaults to 60. */
	warnPercent?: number;

	/** Usage percent where the gauge turns red and the key flashes; defaults to 85. */
	lowPercent?: number;
};

/** Clamps a percentage into gauge range. */
function clampPercent(percent: number): number {
	return Math.max(0, Math.min(100, percent));
}