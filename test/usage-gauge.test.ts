import { describe, expect, it } from "vitest";

import { gaugeSvg, stackedBarSvg, statSvg } from "../src/actions/usage-gauge";

describe("gaugeSvg", () => {
	it("draws the ring arc proportional to usage", () => {
		const arcs = [gaugeSvg(0, "a", "#2ea043"), gaugeSvg(50, "b", "#2ea043"), gaugeSvg(100, "c", "#2ea043")].map(
			(svg) => Number(svg.match(/stroke-dasharray="(\d+(?:\.\d+)?)/)![1]),
		);

		expect(new Set(arcs).size).toBe(3);
		expect(arcs[0]).toBeLessThan(1);
		expect(arcs[1]).toBeGreaterThan(0);
		expect(arcs[2]).toBeCloseTo(arcs[1] * 2, -1);
	});

	it("clamps out-of-range percentages", () => {
		expect(gaugeSvg(-10, "a", "#2ea043")).toBe(gaugeSvg(0, "a", "#2ea043"));
		expect(gaugeSvg(250, "a", "#2ea043")).toBe(gaugeSvg(100, "a", "#2ea043"));
	});

	it("includes the label, color, and shell", () => {
		const svg = gaugeSvg(50, "1.2M", "#e6b45a", "today");

		expect(svg).toMatch(/^<svg/);
		expect(svg).toContain("1.2M");
		expect(svg).toContain("today");
		expect(svg).toContain("#e6b45a");
	});
});

describe("stackedBarSvg", () => {
	const segmentPattern = /<rect x="[\d.]+" y="20" width="(\d+(?:\.\d+)?)" height="22" fill="#(?!262626)[0-9a-f]{6}"/g;

	it("sizes segments proportionally to their share and caps at 4", () => {
		const split = stackedBarSvg([
			{ model: "glm", tokens: 300 },
			{ model: "fable", tokens: 100 },
		]);
		const splitWidths = [...split.matchAll(segmentPattern)].map((m) => Number(m[1]));
		expect(splitWidths).toHaveLength(2);
		expect(splitWidths[1]).toBeCloseTo(splitWidths[0] / 3, 0);

		const capped = stackedBarSvg(Array.from({ length: 8 }, (_, i) => ({ model: `m${i}`, tokens: 10 })));
		expect([...capped.matchAll(segmentPattern)]).toHaveLength(4);
	});

	it("renders the leading model and totals", () => {
		const svg = stackedBarSvg([
			{ model: "glm-5.3-flash", tokens: 1_250_000 },
			{ model: "fable", tokens: 60 },
		]);

		expect(svg).toContain("GLM 5.3");
		expect(svg).toContain("1.25M");
	});
});

describe("statSvg", () => {
	it("renders label, sublabel, and accent without a gauge ring", () => {
		const svg = statSvg("3", "4 live", "#2ea043");

		expect(svg).toMatch(/^<svg/);
		expect(svg).toContain(">3</text>");
		expect(svg).toContain("4");
		expect(svg).toContain("#2ea043");
		expect(svg).not.toContain("stroke-dasharray");
	});
});
