import { KeyAction } from "@elgato/streamdeck";
import { homedir } from "node:os";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";

import { svgDataUri } from "./animations";
import { getModelContextLength } from "./ollama-api";
import { compactTokens, latestTranscript, lastAssistantSummary } from "./claude-transcripts";
import { contextWindowTokens, harnessContextTokens, shortModelName } from "./context-limits";
import { PollingAction } from "./polling-action";
import { gaugeColor, gaugeSvg } from "./usage-gauge";

/** Minutes of transcript silence before the key shows "idle". */
const idleMs = 2 * 60 * 60 * 1000;

/** Bytes read from the tail of the newest transcript — plenty for the last assistant record. */
const tailBytes = 256 * 1024;

/** The harness's own enforced budget (settings.json), read lazily once — it does not change while the plugin runs. */
let harnessBudget: Promise<number | undefined> | undefined;

/**
 * Shows the model of the most recently active Claude Code session, with its context-window fill as the ring.
 */
export class CurrentModel extends PollingAction<CurrentModelSettings> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.elleby.runcommands.claude.model";

	protected override get pollMs(): number {
		// Same brisk cadence as the live-sessions key; plain file reads.
		return 60_000;
	}

	protected override async refresh(action: KeyAction<CurrentModelSettings>): Promise<void> {
		const latest = await latestTranscript(join(homedir(), ".claude"));
		if (latest === undefined || Date.now() - (await stat(latest)).mtimeMs > idleMs) {
			await action.setImage(svgDataUri(gaugeSvg(0, "idle", "#555555")));
			return;
		}

		const summary = await tailSummary(latest);
		if (summary === undefined) {
			await action.setImage(svgDataUri(gaugeSvg(0, "idle", "#555555")));
			return;
		}

		// Chain: PI override → the harness's own enforced budget (settings.json) → the model registry → the built-in table.
		harnessBudget ??= harnessContextTokens(join(homedir(), ".claude"));
		const window = (await action.getSettings()).contextWindowTokens ?? (await harnessBudget) ?? (await getModelContextLength(summary.model)) ?? contextWindowTokens(summary.model);
		const fill = Math.max(0, Math.min(100, (summary.contextTokens / window) * 100));
		const label = `${Math.round(fill)}`;

		await action.setImage(svgDataUri(gaugeSvg(fill, label, gaugeColor(fill, 60, 90), `${compactTokens(summary.contextTokens)} in context`)));
	}
}

/**
 * Settings for {@link CurrentModel}, managed via the Property Inspector.
 */
type CurrentModelSettings = {
	/** Optional context-window override in tokens, e.g. 1048576 for GLM-5.3 on the 1M plan. */
	contextWindowTokens?: number;
};

/**
 * Reads the transcript's tail and extracts the last assistant record.
 * @param path Path to the newest transcript.
 * @returns Model and context tokens, or undefined when the tail holds none.
 */
async function tailSummary(path: string): Promise<{ model: string; contextTokens: number } | undefined> {
	const size = (await stat(path)).size;
	const handle = await open(path, "r");
	try {
		const start = Math.max(0, size - tailBytes);
		const buffer = Buffer.alloc(size - start);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
		return lastAssistantSummary(buffer.subarray(0, bytesRead).toString("utf8"));
	} finally {
		await handle.close();
	}
}