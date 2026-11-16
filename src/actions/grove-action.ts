import streamDeck, { DidReceiveSettingsEvent, KeyAction, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { svgDataUri } from "./animations";
import { scanClaudeUsage } from "./claude-transcripts";
import { getUsage, ollamaTokensDelta } from "./ollama-usage";
import { OllamaApiError } from "./ollama-api";
import { createKeyAnimator, KeyAnimator } from "./key-animator";
import { PollingAction } from "./polling-action";
import { mulberry32 } from "./seeded-rng";
import { soilSvg, tokenBadgeFrames, treeSvg, windPhaseFor, windSteps, type Wind } from "./tree-render";
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
	type GroveTree,
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
	/** Wind strength from the inspector slider, 0-100; unset keeps a gentle default breeze. */
	windForce?: number;
};

/** Milliseconds between feed scans; file reads plus one usage API call. */
const feedPollMs = 60_000;

/** Milliseconds between wind frames; 5 fps with 24 phases gives a 4.8 s sway cycle. */
const windFrameMs = 200;

/** Hold duration after which a press becomes a replant instead. */
const longPressMs = 5_000;

/** Breeze strength, shown on the 0-100 slider, when the inspector never touched it. */
const defaultWindForce = 12.5;

/** Slider 0-100 to render force: the crown leans force/2 * windMaxLean; 100 is a full gale. */
function windForceOf(settings: GroveKeySettings): number {
	return Math.min(2, Math.max(0, ((settings.windForce ?? defaultWindForce) * 2) / 100));
}

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

	/** Wind force per key, 0..1, cached from settings here so wind frames skip the websocket. */
	private readonly windForces = new Map<string, number>();

	/** Last image pushed per key; identical frames are dropped so a still key stays silent. */
	private readonly lastImage = new Map<string, string>();

	/** Each planted key's tree as of its last full paint, so wind frames need no settings roundtrips. */
	private readonly treeViews = new Map<string, { tree: GroveTree; active: boolean }>();

	/** One shared sway loop for all keys, armed only while any key has wind. */
	private windTimer?: ReturnType<typeof setInterval>;

	/** Armed while a planted key is held; firing means a long-press, so the release becomes a no-op. */
	private readonly holdTimers = new Map<string, ReturnType<typeof setTimeout>>();

	protected override async refresh(action: KeyAction<GroveKeySettings>): Promise<void> {
		await this.feed();
		await this.repaintAll();
	}

	/**
	 * Arms the shared sway loop; it stops itself on its first tick when nothing blows.
	 */
	override onWillAppear(ev: WillAppearEvent<GroveKeySettings>): void {
		super.onWillAppear(ev);
		this.ensureWindTimer();
	}

	/**
	 * Forgets a key's caches. The shared wind timer disarms itself on the next tick.
	 */
	override onWillDisappear(ev: WillDisappearEvent<GroveKeySettings>): void {
		const hold = this.holdTimers.get(ev.action.id);
		if (hold !== undefined) {
			clearTimeout(hold);
			this.holdTimers.delete(ev.action.id);
		}
		this.windForces.delete(ev.action.id);
		this.lastImage.delete(ev.action.id);
		this.treeViews.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	/**
	 * A press decides on release: a quick press grows and flashes, a 5 s hold
	 * replants instead. Keying the decision to the hold keeps the press from
	 * applying twice.
	 */
	override async onKeyDown(ev: KeyDownEvent<GroveKeySettings>): Promise<void> {
		const action = ev.action.isKey() ? ev.action : undefined;
		if (action === undefined) {
			return;
		}

		const state = await this.loadGrove();
		if (state.trees[action.id] === undefined) {
			return; // Nothing planted yet — the soil art already says "plant me", and a hold has nothing to erase.
		}
		this.holdTimers.set(action.id, setTimeout(() => {
			this.holdTimers.delete(action.id);
			void this.completeLongPress(action).catch(() => {});
		}, longPressMs));
	}

	/**
	 * The release of a short press grows the tree and flashes its total.
	 * A release after the hold fired (long press) is silent — the replant already ran.
	 */
	override async onKeyUp(ev: KeyUpEvent<GroveKeySettings>): Promise<void> {
		const action = ev.action.isKey() ? ev.action : undefined;
		if (action === undefined) {
			return;
		}
		const hold = this.holdTimers.get(action.id);
		if (hold === undefined) {
			return;
		}
		clearTimeout(hold);
		this.holdTimers.delete(action.id);
		await this.press(action);
	}

	/**
	 * The short press marks the key's tree as the token recipient and flashes its total.
	 * When the inspector's test feed is set, each press also pushes that many tokens
	 * into the woods so growth can be tried without spending any.
	 */
	private async press(action: KeyAction<GroveKeySettings>): Promise<void> {
		// No feed scan here: pressing spams the shared 10 req/min Ollama budget,
		// and the 1 min poll keeps the badge numbers fresh enough.
		const settings = await action.getSettings();
		let state = await this.loadGrove();
		let tree = state.trees[action.id];
		if (tree === undefined) {
			return;
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
			const applied = applyTokenBatch(state, testBatch);
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
	 * Finishes a 5 s hold: the tree starts over — fresh random shape at sprout
	 * growth, species and custom look untouched. No press behavior runs.
	 */
	private async completeLongPress(action: KeyAction<GroveKeySettings>): Promise<void> {
		// Same rng idiom as the inspector's one-shot reset; the seed must differ run to run.
		const reset = resetTree(await this.loadGrove(), action.id, "replant", Date.now(), mulberry32((Date.now() ^ 0x85ebca6b) >>> 0));
		if (!reset.changed) {
			return;
		}
		await this.saveGrove(reset.state);
		await this.repaintAll();

		const tree = reset.state.trees[action.id];
		if (tree !== undefined) {
			await this.animator(action).play(
				tokenBadgeFrames(resolveSpecies(tree), tree.seed, tree.tokens).map(svgDataUri),
				{ fps: 3 },
			);
		}
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
		// A fresh slider value may have armed (or silenced) the sway loop.
		this.ensureWindTimer();
		await this.repaintAll();
	}

	/** Arms the shared sway loop; the tick stops it again when nothing blows. */
	private ensureWindTimer(): void {
		if (this.windTimer === undefined) {
			this.windTimer = setInterval(() => void this.windTick().catch(() => {}), windFrameMs);
		}
	}

	/**
	 * One wind frame: repaint every visible key with a breeze from its cached
	 * snapshot, skipping keys whose badge flash is playing. An unset force still
	 * counts — the default breeze — so the tick never kills itself before paint
	 * has filled the force cache.
	 */
	private async windTick(): Promise<void> {
		const windy = [...this.actions].filter((a) => a.isKey() && this.windForces.get(a.id) !== 0 && !this.animators.get(a.id)?.isPlaying());
		if (windy.length === 0) {
			clearInterval(this.windTimer);
			this.windTimer = undefined;
			return;
		}
		const ticks = Math.floor(Date.now() / windFrameMs);
		const gust = Math.floor(ticks / windSteps);
		await Promise.all(
			windy.map(async (a) => {
				if (!a.isKey()) {
					return;
				}
				// A key not painted yet has no snapshot (and default-breeze force); skip until its first paint lands.
				const view = this.treeViews.get(a.id);
				if (view === undefined) {
					return;
				}
				const { tree, active } = view;
				const force = this.windForces.get(a.id) ?? 0;
				const phase = windPhaseFor(tree.seed, ticks);
				const wind: Wind = { force, phase };
				const image = svgDataUri(treeSvg(resolveSpecies(tree), tree.seed, tree.tokens, { active, wind, leaves: { progress: phase / (2 * Math.PI), gust } }));
				await this.pushImage(a, image);
			}),
		);
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

		// Claude: local files only; the first scan is just a baseline.
		try {
			const usage = await scanClaudeUsage(join(homedir(), ".claude"), now);
			const { delta, feed } = claudeTokensDelta(state.claudeFeed, usage.tokensToday, now);
			if (delta > 0) {
				const applied = applyTokenBatch(state, delta);
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
					const applied = applyTokenBatch(state, delta);
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
	 * Draws a key's tree, or soil if nothing is planted, and refreshes the key's
	 * wind force and tree snapshot for the wind loop. A key whose frame is
	 * unchanged is not re-sent.
	 * @param action The key to draw.
	 */
	private async paint(action: KeyAction<GroveKeySettings>): Promise<void> {
		const settings = await action.getSettings();
		const state = await this.loadGrove();
		const tree = state.trees[action.id];
		if (tree === undefined) {
			this.windForces.set(action.id, 0); // Soil never sways.
			this.treeViews.delete(action.id);
			const soil = settings.species !== undefined && settings.species in SPECIES ? SPECIES[settings.species as keyof typeof SPECIES] : undefined;
			await this.pushImage(action, svgDataUri(soilSvg(soil)));
			return;
		}

		const force = windForceOf(settings);
		this.windForces.set(action.id, force);
		this.treeViews.set(action.id, { tree, active: state.activeTreeId === action.id });
		// Each tree sways on its own slice of the cycle, seed-picked, out of step with the rest.
		const phase = windPhaseFor(tree.seed, Math.floor(Date.now() / windFrameMs));
		const wind: Wind | undefined = force > 0 ? { force, phase } : undefined;
		await this.pushImage(action, svgDataUri(treeSvg(resolveSpecies(tree), tree.seed, tree.tokens, { active: state.activeTreeId === action.id, wind, leaves: { progress: phase / (2 * Math.PI), gust: Math.floor(Date.now() / windFrameMs / windSteps) } })));
	}

	/** Sends an image only when it differs from the last one actually shown. */
	private async pushImage(action: KeyAction<GroveKeySettings>, image: string): Promise<void> {
		if (this.lastImage.get(action.id) === image) {
			return;
		}
		this.lastImage.set(action.id, image);
		await action.setImage(image);
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