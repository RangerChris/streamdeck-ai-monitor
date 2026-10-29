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
	it("renders N distinct well-formed frames, each at its own rotation", () => {
		const frames = spinnerFrames(12);

		expect(frames).toHaveLength(12);
		expect(new Set(frames).size).toBe(12);
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
		const angles = [...frames.join("").matchAll(/rotate\((-?\d+)/g)].map((m) => m[1]);
		expect(new Set(angles).size).toBe(12);
	});
});

describe("successFrames", () => {
	it("renders an outward-growing burst in the success color", () => {
		const frames = successFrames();

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
		const radii = [...frames.join("").matchAll(/r="(\d+)"/g)].map((m) => Number(m[1]));
		expect(Math.min(...radii)).toBeLessThan(Math.max(...radii));
		expect(frames.join("")).toContain(successColor);
	});
});

describe("failureFrames", () => {
	it("renders a shaking burst in the failure color", () => {
		const frames = failureFrames();

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
		const offsets = [...frames.join("").matchAll(/translate\((-?\d+)/g)].map((m) => Number(m[1]));
		expect(Math.min(...offsets)).toBeLessThan(0);
		expect(Math.max(...offsets)).toBeGreaterThan(0);
		expect(frames.join("")).toContain(failureColor);
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