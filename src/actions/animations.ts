/**
 * Encodes an SVG string for `setImage` — Stream Deck app 7.6 silently ignores raw SVG
 * strings on keys, so everything goes over the wire as a base64 data URI.
 * @param svg The raw SVG markup.
 * @returns The data URI to pass to setImage.
 */
export function svgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Success color for confirmation animations. */
export const successColor = "#2ea043";

/** Failure color for error animations. */
export const failureColor = "#d0342c";

/** Key art background, matching the static key image. */
const background = "#141414";

/** Frame shell; keys render at 144x144 (@2x of the 72x72 hardware image). */
function frame(inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${inner}</svg>`;
}

/**
 * Builds a spinner loop: an arc rotating around a command glyph, one frame per step.
 * @param count Number of rotation steps.
 * @returns One full-frame SVG string per step.
 */
export function spinnerFrames(count: number): string[] {
	const arc = (2 * Math.PI * 44 * 0.28).toFixed(2);
	return Array.from({ length: count }, (_, i) =>
		frame([
			`<rect width="144" height="144" fill="${background}"/>`,
			`<g transform="rotate(${Math.round((360 / count) * i)} 72 72)">`,
			`<circle cx="72" cy="72" r="44" fill="none" stroke="#e6e6e6" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc} 999"/>`,
			`</g>`,
			`<text x="72" y="84" font-family="monospace" font-size="32" font-weight="bold" fill="#9a9a9a" text-anchor="middle">&gt;_</text>`,
		].join("")),
	);
}

/**
 * Builds a success burst: a check pops in while a green ring expands and fades.
 * @param frames Number of frames in the burst; defaults to 10.
 * @returns One full-frame SVG string per frame.
 */
export function successFrames(frames = 10): string[] {
	return Array.from({ length: frames }, (_, i) => {
		const t = i / (frames - 1);
		return frame([
			`<rect width="144" height="144" fill="${background}"/>`,
			`<circle cx="72" cy="72" r="${Math.round(30 + t * 40)}" fill="none" stroke="${successColor}" stroke-width="6" opacity="${(1 - t).toFixed(2)}"/>`,
			`<path d="M 48 74 L 66 92 L 98 56" fill="none" stroke="${successColor}" stroke-width="${(12 - t * 4).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`,
		].join(""));
	});
}

/** Horizontal shake offsets, outwards from the impact. */
const shakeOffsets = [8, -8, 5, -5, 3, -3, 1, 0];

/**
 * Builds a failure burst: a red flash, then a red cross shaking to a stop.
 * @returns One full-frame SVG string per frame.
 */
export function failureFrames(): string[] {
	return shakeOffsets.map((shake, i) =>
		frame([
			`<rect width="144" height="144" fill="${i < 2 ? failureColor : background}"/>`,
			`<g transform="translate(${shake} ${Math.round(-shake / 2)})">`,
			`<path d="M 50 50 L 94 94 M 94 50 L 50 94" fill="none" stroke="${i < 2 ? background : failureColor}" stroke-width="10" stroke-linecap="round"/>`,
			`</g>`,
		].join("")),
	);
}