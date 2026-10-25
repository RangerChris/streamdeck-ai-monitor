/** Options for {@link KeyAnimator.play}. */
export type AnimationOptions = {
	/** Frames per second; defaults to 12. */
	fps?: number;

	/** Whether to loop until stopped; defaults to false (one burst, then the idle image returns). */
	loop?: boolean;
};

/** Drives frame-by-frame `setImage` updates for a single key. */
export type KeyAnimator = {
	/**
	 * Plays an animation, replacing any currently playing one.
	 * @param frames Sequence of images to show, one per tick.
	 * @param options Optional fps and loop behavior.
	 */
	play(frames: string[], options?: AnimationOptions): void;

	/** Stops the current animation and restores the key's idle (manifest) image. */
	stop(): void;
};

/**
 * Creates a key animator around an image setter.
 * @param setImage Receives each frame image; called without arguments to restore the idle image.
 * @returns An animator for the key backed by the given setter.
 */
export function createKeyAnimator(setImage: (image?: string) => void | Promise<void>): KeyAnimator {
	let timer: ReturnType<typeof setInterval> | undefined;

	const stop = (): void => {
		if (timer === undefined) {
			return;
		}
		clearInterval(timer);
		timer = undefined;
		void setImage();
	};

	const play = (frames: string[], options?: AnimationOptions): void => {
		if (frames.length === 0) {
			stop();
			return;
		}
		clearInterval(timer);
		void setImage(frames[0]);

		const fps = options?.fps ?? 12;
		let index = 0;
		timer = setInterval(() => {
			index++;
			if (index >= frames.length && !options?.loop) {
				stop();
			} else {
				void setImage(frames[index % frames.length]);
			}
		}, 1000 / fps);
	};

	return { play, stop };
}