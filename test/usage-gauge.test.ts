import { describe, expect, it } from "vitest";

import { gaugeSvg, statSvg } from "../src/actions/usage-gauge";

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
