import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { svgDataUri } from "./animations";
import { compactTokens, scanClaudeUsage } from "./claude-transcripts";
import { PollingAction } from "./polling-action";
import { gaugeSvg } from "./usage-gauge";

/** How often the local transcript scan runs; file reads only, so it can stay slow. */
const transcriptPollMs = 300_000;

/**
 * Aggregates Claude Code transcripts on this machine and shows today's token usage.
 */
export class ClaudeUsage extends PollingAction<Record<string, never>> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.segment7.aimonitor.claude.usage";

	protected override get pollMs(): number {
		return transcriptPollMs;
	}

	protected override async refresh(action: KeyAction<Record<string, never>>): Promise<void> {
		let usage = { tokensToday: 0, tokensWeek: 0 };
		try {
			usage = await scanClaudeUsage(join(homedir(), ".claude"));
		} catch (error) {
			streamDeck.logger.warn("ClaudeUsage: scan failed", String(error));
		}

		// No configured budget — the ring just shows how big today is within the rolling week, which needs no settings.
		const share = usage.tokensWeek > 0 ? (usage.tokensToday / usage.tokensWeek) * 100 : 0;
		const label = compactTokens(usage.tokensToday);

		await action.setImage(svgDataUri(gaugeSvg(share, label, "#2ea043", `of ${compactTokens(usage.tokensWeek)} this week`)));
	}
}