import { KeyAction, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

/**
 * Base class for actions that show a live-updating display: refreshed on appear,
 * on key press, and on a fixed background cadence.
 */
export abstract class PollingAction<TSettings extends JsonObject = JsonObject> extends SingletonAction<TSettings> {
	/** Poll timers, one per action instance, keyed by instance id. */
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

	/** Milliseconds between background refreshes. */
	protected abstract get pollMs(): number;

	/**
	 * Updates the key's display. Should not throw — error handling lives in the implementation.
	 * @param action The key action to update.
	 */
	protected abstract refresh(action: KeyAction<TSettings>): Promise<void>;

	/**
	 * Refreshes immediately and arms the poll timer. Any title the plugin set in older versions is
	 * cleared; the gauge image itself now carries the numbers (ignored if the user set their own title).
	 */
	override onWillAppear(ev: WillAppearEvent<TSettings>): void {
		const action = ev.action.isKey() ? ev.action : undefined;
		if (action === undefined) {
			return;
		}

		void action.setTitle();
		void this.refresh(action);
		this.timers.set(action.id, setInterval(() => void this.refresh(action).catch(() => {}), this.pollMs));
	}

	/**
	 * Tears down the poll timer when the key leaves the page.
	 */
	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		const timer = this.timers.get(ev.action.id);
		if (timer !== undefined) {
			clearInterval(timer);
			this.timers.delete(ev.action.id);
		}
	}

	/**
	 * Manual refresh on press.
	 */
	override async onKeyDown(ev: KeyDownEvent<TSettings>): Promise<void> {
		if (ev.action.isKey()) {
			await this.refresh(ev.action);
		}
	}
}