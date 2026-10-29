import { KeyAction } from "@elgato/streamdeck";

import { failureColor, failureFrames, svgDataUri } from "./animations";
import { OllamaBalance } from "./ollama-api";
import { balanceStore } from "./ollama-balance-store";
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
	 * 1 min cadence; the shared store turns all Ollama keys into one API request per minute.
	 */
	private static readonly pollMs = 60_000;

	/** Last shown usage percent per key, so the red flash only plays when a threshold is newly crossed. */
	private readonly lastUsedPercent = new Map<string, number>();

	/** Red-flash animators per key. */
	private readonly animators = new Map<string, KeyAnimator>();

	protected override get pollMs(): number {
		return OllamaBalanceAction.pollMs;
	}

	protected override async refresh(action: KeyAction<OllamaBalanceSettings>): Promise<void> {
		const reading = await balanceStore.get();

		if (reading.status === "nokey") {
			await action.setImage(svgDataUri(gaugeSvg(100, "OLLAMA_API_KEY", failureColor, "setx it, restart app")));
			return;
		}
		if (reading.status === "badkey") {
			await action.setImage(svgDataUri(gaugeSvg(100, "bad key", failureColor, "ollama.com/settings/keys")));
			return;
		}
		if (reading.status === "keep") {
			return; // Backing off from a 429 or a transient error — keep the last reading on screen.
		}

		await this.render(action, reading.balance);
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
		// The big number is the session percent for percent plans; the ring below stays on weekly usage.
		const label =
			balance.kind === "usd"
				? `$${Math.max(0, balance.allowanceUsd - balance.balanceUsd).toFixed(2)}`
				: `${Math.round((100 - balance.sessionPercent) * 10) / 10}%`;
		// Reset countdown lives on the infobar — the balance key draws no sublabel for percent plans.
		const sublabel = balance.kind === "usd" ? `of $${balance.allowanceUsd.toFixed(0)}` : undefined;

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