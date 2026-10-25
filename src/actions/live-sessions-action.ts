import { KeyAction } from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { svgDataUri, successColor } from "./animations";
import { readSessions } from "./live-sessions";
import { PollingAction } from "./polling-action";
import { statSvg } from "./usage-gauge";

/** How often the registry is polled; plain file reads, so it can stay brisk. */
const registryPollMs = 60_000;

/**
 * Counts live Claude Code sessions on this machine (from the sessions registry): busy sessions big, total live below.
 */
export class LiveSessions extends PollingAction<Record<string, never>> {
	/** Identifies the action in the manifest — plain field instead of the @action decorator (vitest can't transform decorators). */
	override readonly manifestId = "com.elleby.runcommands.claude.sessions";

	protected override get pollMs(): number {
		return registryPollMs;
	}

	protected override async refresh(action: KeyAction<Record<string, never>>): Promise<void> {
		const counts = await readSessions(join(homedir(), ".claude", "sessions"));

		// Green when something is chewing tokens, gray when everything is idle.
		const color = counts.busy > 0 ? successColor : "#555555";
		await action.setImage(svgDataUri(statSvg(`${counts.busy}`, `${counts.total} live`, color)));
	}
}