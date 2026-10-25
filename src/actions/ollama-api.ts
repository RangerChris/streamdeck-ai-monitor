/** The base URL of the Ollama cloud API. */
const baseUrl = "https://ollama.com";

/** Error thrown for any non-OK Ollama API response. */
export class OllamaApiError extends Error {
	/** HTTP status the API returned. */
	readonly status: number;

	/** Seconds the API asked us to back off (Retry-After), when present. */
	readonly retryAfterSeconds?: number;

	constructor(status: number, retryAfterSeconds?: number) {
		super(`Ollama API error ${status}${retryAfterSeconds !== undefined ? `, retry in ${retryAfterSeconds}s` : ""}`);
		this.name = "OllamaApiError";
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/** Normalized balance, covering the two documented response shapes. */
export type OllamaBalance =
	| { kind: "usd"; balanceUsd: number; allowanceUsd: number; purchasedUsd: number; resetsAt?: string }
	| { kind: "percent"; sessionPercent: number; weeklyPercent: number; resetsAt?: string };

/**
 * Fetches JSON from the Ollama API with bearer auth.
 * @param path The endpoint path, e.g. "/api/balance".
 * @param apiKey The API key.
 * @returns The parsed body.
 */
async function getJson(path: string, apiKey: string): Promise<any> {
	const response = await fetch(`${baseUrl}${path}`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		const retryAfter = Number(response.headers.get("Retry-After") ?? NaN);
		throw new OllamaApiError(response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
	}

	return response.json();
}

/**
 * Fetches the account balance, normalizing credit plans and legacy subscriptions.
 * @param apiKey The API key.
 * @returns The remaining credits (usd) or remaining session/weekly percent.
 */
export async function getBalance(apiKey: string): Promise<OllamaBalance> {
	const body: any = await getJson("/api/balance", apiKey);
	const included = body.included ?? {};

	if (typeof included.balance_usd === "number") {
		return {
			kind: "usd",
			balanceUsd: included.balance_usd,
			allowanceUsd: typeof included.allowance_usd === "number" ? included.allowance_usd : 0,
			purchasedUsd: typeof body.purchased?.balance_usd === "number" ? body.purchased.balance_usd : 0,
			resetsAt: typeof included.period?.until === "string" ? included.period.until : undefined,
		};
	}

	return {
		kind: "percent",
		sessionPercent: Number(included.session?.remaining_percent ?? 0),
		weeklyPercent: Number(included.weekly?.remaining_percent ?? 0),
		resetsAt: typeof included.weekly?.resets_at === "string" ? included.weekly.resets_at : undefined,
	};
}
/** Model metadata is effectively immutable in practice, so /api/show answers are cached forever. */
const contextLengthCache = new Map<string, number | undefined>();

/**
 * Reads a model's context length from Ollama's model registry (POST /api/show, no auth required).
 * @param model The model name, e.g. "glm-5.3-flash".
 * @returns The context length in tokens, or undefined when the registry has none or the call fails.
 */
export async function getModelContextLength(model: string): Promise<number | undefined> {
	const cached = contextLengthCache.get(model);
	if (cached !== undefined) {
		return cached;
	}

	let result: number | undefined;
	try {
		const response = await fetch(`${baseUrl}/api/show`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model }),
		});
		if (!response.ok) {
			throw new OllamaApiError(response.status);
		}

		const body: any = await response.json();
		const info = body.model_info ?? {};
		const key = Object.keys(info).find((name) => name.endsWith(".context_length"));
		result = key !== undefined && typeof info[key] === "number" && info[key] > 0 ? info[key] : undefined;
	} catch {
		result = undefined; // Registry hiccup or unknown model — callers fall back to the built-in table.
	}

	// Only real answers are cached; a failed lookup retries on the next poll instead of sticking forever.
	if (result !== undefined) {
		contextLengthCache.set(model, result);
	}
	return result;
}
