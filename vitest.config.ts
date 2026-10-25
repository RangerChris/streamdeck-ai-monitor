import { defineConfig } from "vitest/config";

export default defineConfig({
	// The action classes use stage-3 (native) decorators, which Node 24 executes directly;
	// tell esbuild to leave them alone instead of trying to downlevel them.
	esbuild: {
		target: "esnext",
		supported: { decorator: true },
	},
});