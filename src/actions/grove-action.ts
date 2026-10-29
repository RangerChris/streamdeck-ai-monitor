import streamDeck, { KeyAction, KeyDownEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { svgDataUri } from "./animations";
import { scanClaudeUsage } from "./claude-transcripts";
import { getUsage, ollamaTokensDelta } from "./ollama-usage";
import { OllamaApiError } from "./ollama-api";
import { createKeyAnimator, KeyAnimator } from "./key-animator";
import { PollingAction } from "./polling-action";
import { mulberry32 } from "./seeded-rng";
import { soilSvg, tokenBadgeFrames, treeSvg } from "./tree-render";
import {
	applyTokenBatch,
	claudeTokensDelta,
	customPalette,
	groveFromGlobalSettings,
	resetTree,
	resolveSpecies,
	syncKeyTree,
	SPECIES,
	type CustomPalette,
	type GroveState,
} from "./grove-core";

/**
 * Plants a tree on a button that grows as you burn AI tokens: Claude transcript
 * tokens and Ollama usage deltas feed one tree, pressing picks the recipient
 * and flashes its total, and the Property Inspector plants / replants species.
 */

/** Settings per planted key, managed via the Property Inspector. */
type GroveKeySettings = {
	/** Species selected in the inspector; empty or unknown means soil. */
	species?: string;
	/** Custom species look from the inspector. */
	customTrunk?: string;
	/** Custom species look from the inspector. */
	customCanopy?: string;
	/** Custom species look from the inspector. */
	customAccent?: string;
	/** Custom species look from the inspector. */
	customCost?: number;
	/** One-shot: the next press zeroes the tree (same shape) and clears the flag. */
	resetOnPress?: boolean;
	/** Tokens per manual press, for testing growth without real spend; unset disables it. */
	testBatch?: number;
};

/** Milliseconds between feed scans; file reads plus one usage API call. */
const feedPollMs = 60_000;

export class GroveAction extends PollingAction<GroveKeySettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.grove";

	protected override get pollMs(): number {
		return feedPollMs;
	}

	/** Prevents overlapping or per-key-doubled feed scans from routing the same delta twice. */
	private feedInFlight?: Promise<string[]>;

	/** Badge flash animators per key. */
	private readonly animators = new Map<string, KeyAnimator>();

	/** When the Ollama usage API may be hit again per the shared rate budget. */
	private nextUsageAt = 0;

	protected override async refresh(action: KeyAction<GroveKeySettings>): Promise<void> {
		await this.feed();
		await this.repaintAll();
	}

	/**
	 * Pressing marks the key's tree as the token recipient and flashes its total.
	 * When the inspector's test feed is set, each press also pushes that many
	 * tokens into the woods so growth can be tried without spending any.
	 */
	override async onKeyDown(ev: KeyDownEvent<GroveKeySettings>): Promise<void> {
		const action = ev.action.isKey() ? ev.action : undefined;
		if (action === undefined) {
			return;
		}

		// No feed scan here: pressing spams the shared 10 req/min Ollama budget,
		// and the 1 min poll keeps the badge numbers fresh enough.
		const settings = await action.getSettings();
		let state = await this.loadGrove();
		let tree = state.trees[action.id];
		if (tree === undefined) {
			return; // Nothing planted yet — the soil art already says "plant me".
		}

		let repaint = state.activeTreeId !== action.id;
		if (repaint) {
			state = { ...state, activeTreeId: action.id };
		}
		// One-shot reset: the inspector checkbox zeroes the tree (same shape),
		// then clears itself so the next presses feed growth again.
		if (settings.resetOnPress === true && tree !== undefined) {
			state = resetTree(state, action.id, "regrow", Date.now(), mulberry32((Date.now() ^ 0x85ebca6b) >>> 0)).state;
			tree = state.trees[action.id];
			repaint = true;
			await action.setSettings({ ...settings, resetOnPress: false });
		}
		// Test feeds arrive as strings ("5000"), and garbage text stays NaN → ignored.
		const testBatch = Math.floor(Number(settings.testBatch ?? NaN));
		if (Number.isFinite(testBatch) && testBatch > 0) {
			const applied = applyTokenBatch(state, testBatch, mulberry32((Date.now() ^ 0x1e3779b9) >>> 0));
			state = applied.state;
			tree = state.trees[action.id];
			repaint = true;
		}
		if (repaint && tree !== undefined) {
			await this.saveGrove(state);
			await this.repaintAll();
		}
		if (tree === undefined) {
			return;
		}

		await this.animator(action).play(
			tokenBadgeFrames(resolveSpecies(tree), tree.seed, tree.tokens).map(svgDataUri),
			{ fps: 3 },
		);
	}

	/**
	 * The inspector drives planting: picking a species plants a tree, switching
	 * species replants, and clearing the selection digs it back up.
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GroveKeySettings>): Promise<void> {
		const action = ev.action.isKey() ? ev.action : undefined;
		if (action === undefined) {
			return;
		}

		const settings = await action.getSettings();
		const custom = settings.species === "custom" ? customPalette(settings) : undefined;
		const synced = syncKeyTree(await this.loadGrove(), action.id, settings.species, Date.now(), mulberry32(Math.floor(Math.random() * 0xffffffff)), custom);
		if (synced.changed) {
			await this.saveGrove(synced.state);
		}
		await this.repaintAll();
	}

	/**
	 * Runs one feed cycle: Claude transcript tokens plus Ollama usage deltas go
	 * to the woods as batches. Concurrent and repeat calls share the in-flight
	 * run, so two keys never route the same delta twice.
	 * @returns Ids of trees that received tokens.
	 */
	private feed(): Promise<string[]> {
		this.feedInFlight ??= this.runFeeds()
			.catch((error) => {
				streamDeck.logger.warn("Grove: feed scan failed", String(error));
				return [] as string[];
			})
			.finally(() => {
				this.feedInFlight = undefined;
			});
		return this.feedInFlight;
	}

	private async runFeeds(): Promise<string[]> {
		let state = await this.loadGrove();
		let dirty = false;
		const changed = new Set<string>();
		const now = new Date();
		// Per-batch seed; only the fallback recipient pick and replant seeds consume it.
		const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

		// Claude: local files only; the first scan is just a baseline.
		try {
			const usage = await scanClaudeUsage(join(homedir(), ".claude"), now);
			const { delta, feed } = claudeTokensDelta(state.claudeFeed, usage.tokensToday, now);
			if (delta > 0) {
				const applied = applyTokenBatch(state, delta, rng);
				state = applied.state;
				applied.changedTreeIds.forEach((id) => changed.add(id));
			}
			const feedChanged = state.claudeFeed?.date !== feed.date || state.claudeFeed?.tokens !== feed.tokens;
			state = { ...state, claudeFeed: feed };
			dirty = dirty || feedChanged || delta > 0;
		} catch (error) {
			streamDeck.logger.warn("Grove: Claude scan failed", String(error));
		}

		// Ollama cloud usage: keyed off the same env var as the balance action,
		// backing off on a 429 since /api/usage shares that 10 req/min budget.
		const apiKey = process.env.OLLAMA_API_KEY;
		if (apiKey && Date.now() >= this.nextUsageAt) {
			try {
				const usage = await getUsage(apiKey);
				const { delta, buckets } = ollamaTokensDelta(state.ollamaFeed?.buckets, usage);
				if (delta > 0) {
					const applied = applyTokenBatch(state, delta, rng);
					state = applied.state;
					applied.changedTreeIds.forEach((id) => changed.add(id));
					dirty = true;
				}
			} catch (error) {
				if (error instanceof OllamaApiError) {
					if (error.retryAfterSeconds !== undefined) {
						this.nextUsageAt = Date.now() + error.retryAfterSeconds * 1000;
					}
					streamDeck.logger.warn("Grove: Ollama usage rate-limited", error.status);
				} else {
					streamDeck.logger.warn("Grove: Ollama usage failed", String(error));
				}
			}
		}

		if (dirty) {
			await this.saveGrove(state);
		}
		return [...changed];
	}

	/** Repaints every visible grove key; the glow ring and growth can move between keys. */
	private async repaintAll(): Promise<void> {
		await Promise.all([...this.actions].map((a) => (a.isKey() ? this.paint(a) : Promise.resolve())));
	}

	/**
	 * Draws a key's tree, or soil if nothing is planted.
	 * @param action The key to draw.
	 */
	private async paint(action: KeyAction<GroveKeySettings>): Promise<void> {
		const state = await this.loadGrove();
		const tree = state.trees[action.id];
		if (tree === undefined) {
			const settings = await action.getSettings();
			await action.setImage(svgDataUri(soilSvg(settings.species !== undefined && settings.species in SPECIES ? SPECIES[settings.species as keyof typeof SPECIES] : undefined)));
			return;
		}
		await action.setImage(svgDataUri(treeSvg(resolveSpecies(tree), tree.seed, tree.tokens, { active: state.activeTreeId === action.id })));
	}

	/**
	 * Gets or creates the badge animator for a key; the idle image is the
	 * key's own tree, not the manifest art, so restore re-renders it.
	 * @param action The key to animate.
	 */
	private animator(action: KeyAction<GroveKeySettings>): KeyAnimator {
		let animator = this.animators.get(action.id);
		if (animator === undefined) {
			animator = createKeyAnimator((image) => (image === undefined ? this.paint(action) : action.setImage(image)));
			this.animators.set(action.id, animator);
		}
		return animator;
	}

	private async loadGrove(): Promise<GroveState> {
		return groveFromGlobalSettings((await streamDeck.settings.getGlobalSettings()) as Record<string, unknown>);
	}

	private async saveGrove(state: GroveState): Promise<void> {
		await streamDeck.settings.setGlobalSettings({ ...(await streamDeck.settings.getGlobalSettings()), grove: state });
	}
}