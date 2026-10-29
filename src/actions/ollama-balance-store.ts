import { getBalance, OllamaApiError, OllamaBalance } from "./ollama-api";

/** Freshness window for a reading; all Ollama keys ask once a minute and share the answer. */
const ttlMs = 60_000;

/** One shared balance reading: fresh data, an env/setup problem, or a signal to keep the last picture. */
export type BalanceReading =
	| { status: "nokey" }
	| { status: "ok"; balance: OllamaBalance }
	| { status: "badkey" }
	| { status: "keep" };

/**
 * Fetches the Ollama balance for all Ollama keys from a single request: callers
 * within the freshness window share the cached reading, concurrent calls share
 * the in-flight one, and a 429's Retry-After holds new requests off.
 */
export class OllamaBalanceStore {
	/** Last good reading, kept across failed fetches so "keep" callers never blank. */
	private balance: OllamaBalance | undefined;
	private fetchedAt = -Infinity;
	private inFlight: Promise<BalanceReading> | undefined;
	private nextAttemptAt = 0;

	/**
	 * @param now Injectable clock for tests.
	 */
	constructor(private readonly now: () => number = Date.now) {}

	/**
	 * Gets the shared balance reading, fetching when the cache is older than a minute.
	 * @returns A reading to render, or "keep" to hold the current picture.
	 */
	get(): Promise<BalanceReading> {
		const apiKey = process.env.OLLAMA_API_KEY;
		if (!apiKey) {
			return Promise.resolve({ status: "nokey" });
		}
		if (this.now() < this.nextAttemptAt) {
			return Promise.resolve({ status: "keep" });
		}
		if (this.balance !== undefined && this.now() - this.fetchedAt < ttlMs) {
			return Promise.resolve({ status: "ok", balance: this.balance });
		}
		return (this.inFlight ??= this.fetchFresh(apiKey).finally(() => {
			this.inFlight = undefined;
		}));
	}

	/**
	 * Performs the single API request the store may make this minute.
	 * @param apiKey The Ollama API key.
	 * @returns The reading, mapped from the fetch outcome.
	 */
	private async fetchFresh(apiKey: string): Promise<BalanceReading> {
		try {
			this.balance = await getBalance(apiKey);
			this.fetchedAt = this.now();
			return { status: "ok", balance: this.balance };
		} catch (error) {
			if (error instanceof OllamaApiError) {
				if (error.status === 401) {
					return { status: "badkey" };
				}
				if (error.retryAfterSeconds !== undefined) {
					this.nextAttemptAt = this.now() + error.retryAfterSeconds * 1000;
				}
			}
			return { status: "keep" };
		}
	}
}

/** The shared instance all Ollama keys read. */
export const balanceStore = new OllamaBalanceStore();