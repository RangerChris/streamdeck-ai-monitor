import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	failureColor,
	failureFrames,
	spinnerFrames,
	successColor,
	successFrames,
} from "../src/actions/animations";
import { createKeyAnimator } from "../src/actions/key-animator";

describe("spinnerFrames", () => {
	it("produces the requested number of distinct frames", () => {
		const frames = spinnerFrames(12);

		expect(frames).toHaveLength(12);
		expect(new Set(frames).size).toBe(12);
	});

	it("renders a well-formed SVG", () => {
		const frame = spinnerFrames(1)[0];

		expect(frame).toMatch(/^<svg/);
		expect(frame).toMatch(/<\/svg>$/);
	});

	it("places each frame at a different rotation", () => {
		const frames = spinnerFrames(4);
		const angles = [...frames.join("").matchAll(/rotate\((-?\d+)/g)].map((m) => m[1]);

		expect(new Set(angles).size).toBe(4);
	});
});

describe("successFrames", () => {
	it("renders a burst of well-formed SVG frames", () => {
		const frames = successFrames();

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
	});

	it("animates the confirmation ring outward", () => {
		const frames = successFrames();
		const radii = [...frames.join("").matchAll(/r="(\d+)"/g)].map((m) => Number(m[1]));

		expect(Math.min(...radii)).toBeLessThan(Math.max(...radii));
	});

	it("uses the success color", () => {
		expect(successFrames().join("")).toContain(successColor);
	});
});

describe("failureFrames", () => {
	it("renders a burst of well-formed SVG frames", () => {
		const frames = failureFrames();

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
	});

	it("shakes the marker horizontally", () => {
		const frames = failureFrames();
		const offsets = [...frames.join("").matchAll(/translate\((-?\d+)/g)].map((m) => Number(m[1]));

		expect(Math.min(...offsets)).toBeLessThan(0);
		expect(Math.max(...offsets)).toBeGreaterThan(0);
	});

	it("uses the failure color", () => {
		expect(failureFrames().join("")).toContain(failureColor);
	});
});

describe("createKeyAnimator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function collecting() {
		const images: (string | undefined)[] = [];
		const animator = createKeyAnimator((image) => {
			images.push(image);
		});
		return { animator, images };
	}

	it("shows each frame in order and restores the idle image", () => {
		const { animator, images } = collecting();

		animator.play(["a", "b", "c"], { fps: 10 });
		vi.advanceTimersByTime(300);

		expect(images).toEqual(["a", "b", "c", undefined]);
	});

	it("keeps looping until stopped", () => {
		const { animator, images } = collecting();

		animator.play(["a", "b"], { fps: 10, loop: true });
		vi.advanceTimersByTime(250);

		expect(images).toEqual(["a", "b", "a"]);

		animator.stop();
		vi.advanceTimersByTime(100);

		expect(images).toEqual(["a", "b", "a", undefined]);
	});

	it("replaces a playing animation when replayed", () => {
		const { animator, images } = collecting();

		animator.play(["a", "b"], { fps: 10, loop: true });
		animator.play(["x"], { fps: 10 });
		vi.advanceTimersByTime(500);

		expect(images).toEqual(["a", "x", undefined]);
	});

	it("is inert when stopped without playing", () => {
		const { animator, images } = collecting();

		animator.stop();
		animator.play([], { fps: 10 });

		expect(images).toEqual([]);
	});
});