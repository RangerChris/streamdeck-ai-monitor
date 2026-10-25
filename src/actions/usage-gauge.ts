import { compactTokens } from "./claude-transcripts";
import { shortModelName } from "./context-limits";
import { successColor } from "./animations";

/** Background matching the static key art. */
const backgroundColor = "#141414";

/** Unfilled track behind the gauge arc. */
const trackColor = "#262626";

/** Gauge ring geometry. */
const radius = 52;
const circumference = 2 * Math.PI * radius;

/**
 * Escapes the few characters that matter for label text inside SVG.
 * @param text The raw text.
 * @returns The XML-safe text.
 */
export function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Builds a ring gauge: an arc proportional to usage, with the headline value in the middle.
 * @param percent Usage percentage; clamped to 0-100.
 * @param label The main center value, e.g. "$72.50".
 * @param color The gauge arc color.
 * @param sublabel Optional smaller line under the label, e.g. "3h 05m".
 * @returns A full-frame SVG string.
 */
export function gaugeSvg(percent: number, label: string, color: string, sublabel?: string): string {
	const clamped = Math.abs(Math.max(0, Math.min(100, percent)));
	const arc = ((circumference * clamped) / 100).toFixed(2);
	const fontSize = label.length > 5 ? 26 : label.length > 3 ? 30 : 36;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">`,
		`<rect width="144" height="144" fill="${backgroundColor}"/>`,
		`<circle cx="72" cy="72" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="12"/>`,
		`<g transform="rotate(-90 72 72)"><circle cx="72" cy="72" r="${radius}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${arc} 999"/></g>`,
		`<text x="72" y="${sublabel ? 76 : 86}" font-family="'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="600" fill="#e6e6e6" text-anchor="middle">${escapeXml(label)}</text>`,
		sublabel !== undefined
			? `<text x="72" y="102" font-family="'Segoe UI', sans-serif" font-size="15" fill="#8a8a8a" text-anchor="middle">${escapeXml(sublabel)}</text>`
			: "",
		`</svg>`,
	].join("");
}

/** Warm amber for the middle of the gauge. */
export const warnColor = "#e6b45a";

/** Convenience re-export so actions share one success tone. */
export { successColor };

/**
 * Picks the gauge color from usage against amber/red thresholds.
 * @param percent Usage percentage, 0-100.
 * @param warnPercent Where amber starts; defaults to 60.
 * @param lowPercent Where red starts; defaults to 85.
 * @returns Green, amber, or red.
 */
export function gaugeColor(percent: number, warnPercent = 60, lowPercent = 85): string {
	if (percent >= lowPercent) {
		return "#d0342c";
	}
	if (percent >= warnPercent) {
		return warnColor;
	}
	return successColor;
}
/** Segment colors for the stacked model-mix bar. */
export const segmentPalette = ["#2ea043", "#4e9fe0", "#e6b45a", "#c678dd"];

/**
 * Builds the model-mix view: a stacked bar of today's token shares plus the leading model's name and total.
 * @param models Model usages, largest first (the aggregateByModel output shape).
 * @returns A full-frame SVG string; at most 4 segments are drawn.
 */
export function stackedBarSvg(models: Array<{ model: string; tokens: number }>): string {
	const top = models.slice(0, 4);
	const total = models.reduce((sum, model) => sum + model.tokens, 0) || 1;
	const barWidth = 120;

	let x = 12;
	const segments = top.map((entry, i) => {
		const width = (entry.tokens / total) * barWidth;
		const rect = `<rect x="${Number(x.toFixed(1))}" y="20" width="${width.toFixed(1)}" height="22" fill="${segmentPalette[i]}"/>`;
		x += width;
		return rect;
	});

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">`,
		`<rect width="144" height="144" fill="${backgroundColor}"/>`,
		`<rect x="12" y="20" width="${barWidth}" height="22" fill="${trackColor}"/>`,
		...segments,
		`<text x="72" y="80" font-family="sans-serif" font-size="26" font-weight="600" fill="#e6e6e6" text-anchor="middle">${shortModelName(top[0].model)}</text>`,
		`<text x="72" y="104" font-family="sans-serif" font-size="16" fill="#8a8a8a" text-anchor="middle">${compactTokens(top[0].tokens)}</text>`,
		`</svg>`,
	].join("");
}

/**
 * Builds a plain stat tile: big number, caption below, no gauge ring.
 * @param label The big value, e.g. "3".
 * @param sublabel The small caption, e.g. "1 live".
 * @param color Accent for a small underline under the label.
 * @returns A full-frame SVG string.
 */
export function statSvg(label: string, sublabel: string, color: string): string {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">`,
		`<rect width="144" height="144" fill="${backgroundColor}"/>`,
		`<text x="72" y="76" font-family="sans-serif" font-size="44" font-weight="700" fill="#e6e6e6" text-anchor="middle">${escapeXml(label)}</text>`,
		`<rect x="52" y="88" width="40" height="5" rx="2.5" fill="${color}"/>`,
		`<text x="72" y="112" font-family="sans-serif" font-size="15" fill="#8a8a8a" text-anchor="middle">${escapeXml(sublabel)}</text>`,
		`</svg>`,
	].join("");
}
