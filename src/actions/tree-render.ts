import { compactTokens } from "./claude-transcripts";
import { mulberry32 } from "./seeded-rng";
import { escapeXml } from "./usage-gauge";
import type { TreeSpecies } from "./grove-core";

/** Background matching the static key art. */
const backgroundColor = "#141414";

/** Frame shell; keys render at 144x144 (@2x of the 72x72 hardware image). */
function frame(inner: string, defs = ""): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${defs}${inner}</svg>`;
}

/** Trunk ground level; a few px above the frame edge for a soil lip. */
const groundY = 138;

/** Center of the key, where trunks are planted. */
const centerX = 72;

function smoothstep(x: number): number {
	const t = Math.min(1, Math.max(0, x));
	return t * t * (3 - 2 * t);
}

/** Canopy blobs and their light overlays share one shape. */
type Blob = {
	dx: number;
	dy: number;
	r: number;
	color: string;
};

/** One branch of the mature skeleton, precomputed from the seed only. */
type Branch = {
	depth: number;
	/** Start point on the parent's mature tip. */
	x0: number;
	y0: number;
	/** Direction, radians; -PI/2 is straight up. */
	angle: number;
	/** Mature length, px. */
	length: number;
	/** Mature stroke width, px. */
	thickness: number;
	/** Growth threshold (in eased time) at which this branch starts appearing, 0..0.85. */
	birth: number;
	/** Dark canopy mass blobs at the mature tip, precomputed positions/colors. */
	blobs: Blob[];
	/** Light overlays + accents drawn over the whole mass pass. */
	dabs: Blob[];
};

/** Branch spread window: a branch is fully out at birth + window. */
const appearWindow = 0.15;

/** Frame margins the mature tree must respect, in px. */
const fitTopY = 10;
const fitSideX = 5;

/**
 * Uniformly scales a skeleton about the planting point so the mature crown
 * (tips and canopy blobs) stays inside the frame margins. Angles and shape
 * are untouched; scaling all lengths keeps every descendant tip proportional.
 * @param branches The fully-grown skeleton.
 * @returns The same shape, fitted to the key.
 */
function fitToKey(branches: Branch[]): Branch[] {
	let minY = groundY;
	let minX = centerX;
	let maxX = centerX;
	for (const branch of branches) {
		const tipX = branch.x0 + Math.cos(branch.angle) * branch.length;
		const tipY = branch.y0 + Math.sin(branch.angle) * branch.length;
		const half = branch.thickness / 2;
		minY = Math.min(minY, tipY - half);
		minX = Math.min(minX, tipX - half);
		maxX = Math.max(maxX, tipX + half);
		for (const blob of branch.blobs) {
			minY = Math.min(minY, tipY + blob.dy - blob.r);
			minX = Math.min(minX, tipX + blob.dx - blob.r);
			maxX = Math.max(maxX, tipX + blob.dx + blob.r);
		}
	}

	let scale = 1;
	if (minY < fitTopY) {
		scale = (groundY - fitTopY) / (groundY - minY);
	}
	if (minX < fitSideX) {
		scale = Math.min(scale, (centerX - fitSideX) / (centerX - minX));
	}
	if (maxX > 144 - fitSideX) {
		scale = Math.min(scale, (centerX - fitSideX) / (maxX - centerX));
	}

	if (scale === 1) {
		return branches;
	}
	return branches.map((branch) => ({
		...branch,
		length: branch.length * scale,
		thickness: branch.thickness * scale,
		x0: centerX + (branch.x0 - centerX) * scale,
		y0: groundY + (branch.y0 - groundY) * scale,
		blobs: branch.blobs.map((blob) => ({ ...blob, dx: blob.dx * scale, dy: blob.dy * scale, r: blob.r * scale })),
		dabs: branch.dabs.map((blob) => ({ ...blob, dx: blob.dx * scale, dy: blob.dy * scale, r: blob.r * scale })),
	}));
}

/**
 * Lays the canopy as one solid mass: the crown envelope is derived from the
 * canopy-bearing tips, then a jittered grid of dark mass blobs inside a crown
 * ellipse fills it — blob size merges them into foliage, and light overlays +
 * accents are kept separate so they can be drawn over the whole mass.
 * @param branches The skeleton to crown (mutated in place).
 * @param species Resolved species profile.
 * @param rng The structure RNG continued from the skeleton build.
 */
function attachCanopy(branches: Branch[], species: TreeSpecies, rng: () => number): void {
	// Canopy starts well inside the crown so the mass fills, not just caps the outer
	// tips. Conifers need foliage up the trunk early or they read as bare red sticks.
	const crownDepth = species.canopyStyle === "blossom" ? 2 : species.canopyStyle === "conifer" ? species.maxDepth - 3 : species.maxDepth - 2;
	const bearers = branches.filter((b) => b.depth >= crownDepth);
	if (bearers.length === 0) {
		return;
	}

	const tipOf = (b: Branch): { x: number; y: number } => ({ x: b.x0 + Math.cos(b.angle) * b.length, y: b.y0 + Math.sin(b.angle) * b.length });
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;
	for (const bearer of bearers) {
		const tip = tipOf(bearer);
		top = Math.min(top, tip.y);
		bottom = Math.max(bottom, tip.y);
		left = Math.min(left, tip.x);
		right = Math.max(right, tip.x);
	}

	// Crown envelope: reach beyond the tips and sag downward for mass. The floor
	// widths keep small-spread species (birch) from skimping on foliage.
	const conifer = species.canopyStyle === "conifer";
	const rx = Math.max(conifer ? 18 : 27, ((right - left) / 2) * 1.25 + 5);
	const ry = Math.max(conifer ? 20 : 26, ((bottom - top) / 2) * 0.9 + 19);
	const cx = (left + right) / 2;
	const cy = top + ry;

	const rAvg = conifer ? 4.5 : 7;
	const cell = rAvg * 1.25;
	const cols = Math.ceil((rx * 2) / cell);
	const rows = Math.ceil((ry * 2) / cell);
	for (let row = 0; row <= rows; row++) {
		for (let col = 0; col <= cols; col++) {
			const px = cx - rx + col * cell + (rng() - 0.5) * cell * 0.8;
			const py = cy - ry + row * cell + (rng() - 0.5) * cell * 0.8;
			// Keep centers inside a slightly shrunken ellipse so radii stay in frame.
			const norm = ((px - cx) / (rx * 0.88)) ** 2 + ((py - cy) / (ry * 0.88)) ** 2;
			if (norm > 1) {
				continue;
			}

			// Anchor to the nearest bearer's tip so appearance tracks branch growth.
			let carrier = bearers[0];
			let bestD = Infinity;
			for (const bearer of bearers) {
				const tip = tipOf(bearer);
				const d = (tip.x - px) ** 2 + (tip.y - py) ** 2;
				if (d < bestD) {
					bestD = d;
					carrier = bearer;
				}
			}
			const tip = tipOf(carrier);
			const dx = px - tip.x;
			const dy = py - tip.y;
			const r = rAvg * (0.8 + rng() * 0.4);
			carrier.blobs.push({ dx, dy, r, color: species.palette.canopy[0] });
			carrier.dabs.push({ dx: dx + r * 0.28, dy: dy - r * 0.3, r: r * 0.5, color: species.palette.canopy[species.palette.canopy.length - 1] });
			// Accents: blossoms scatter generously, other species drop the odd fruit.
			if (species.palette.accent !== undefined && rng() < (species.canopyStyle === "blossom" ? 0.45 : 0.18)) {
				carrier.dabs.push({ dx: dx + (rng() - 0.5) * r, dy: dy + (rng() - 0.5) * r, r: r * 0.42, color: species.palette.accent });
			}
		}
	}
}

/**
 * Grows the mature branch skeleton from the seed. All randomness is spent here,
 * so the draw pass stays a pure function of the skeleton plus growth.
 */
function structure(species: TreeSpecies, seed: number): Branch[] {
	const rng = mulberry32(seed);
	const branches: Branch[] = [];

	// Depth 0 trunk: tall enough to matter, thin enough to look young while growing.
	const rootLength = species.heightRatio * 144 * (0.42 + rng() * 0.1);
	const root: Branch = {
		depth: 0,
		x0: centerX,
		y0: groundY,
		angle: -Math.PI / 2 + (rng() - 0.5) * 0.1,
		length: rootLength,
		thickness: 4 + species.heightRatio * 3,
		birth: 0,
		blobs: [],
		dabs: [],
	};
	branches.push(root);

	const grow = (parent: Branch, depth: number) => {
		if (depth > species.maxDepth) {
			return;
		}
		const factor = species.branchFactor[Math.min(depth - 1, species.branchFactor.length - 1)];
		const bias = species.curvature[Math.min(depth - 1, species.curvature.length - 1)];
		for (let i = 0; i < factor; i++) {
			const spread = (species.angleSpread * Math.PI) / 180;
			// Fan children out symmetrically around the parent, then wobble and twist (curvature bias).
			const fan = i - (factor - 1) / 2;
			const angle = parent.angle + fan * spread * (0.6 + rng() * 0.8) + (bias * Math.PI) / 180;
			const length = parent.length * species.lengthRatio * (0.7 + rng() * 0.5);
			const thickness = Math.max(1, parent.thickness * (0.5 + rng() * 0.2));
			const x0 = parent.x0 + Math.cos(parent.angle) * parent.length;
			const y0 = parent.y0 + Math.sin(parent.angle) * parent.length;
			const birth = Math.min(0.85, (depth - 1) / species.maxDepth + rng() * 0.25);
			const branch: Branch = {
				depth,
				x0,
				y0,
				angle,
				length,
				thickness,
				birth,
				blobs: [],
				dabs: [],
			};
			branches.push(branch);
			grow(branch, depth + 1);
		}
	};
	grow(root, 1);
	attachCanopy(branches, species, rng);
	return fitToKey(branches);
}

/**
 * Builds the tree image for a given growth state.
 * @param species Resolved species profile.
 * @param seed The tree's shape seed; same seed, same silhouette.
 * @param tokens Tokens the tree has received so far.
 * @param options Pass `active: true` to add the selection glow.
 * @returns A full-frame SVG string.
 */
export function treeSvg(species: TreeSpecies, seed: number, tokens: number, options?: { active?: boolean }): string {
	const growth = Math.min(1, tokens / species.costTokens);
	const skeleton = structure(species, seed);

	// Square-root easing: the sprout leaves the ground fast, then the tree matures slowly.
	const t = Math.sqrt(growth);

	const branchParts: string[] = [];
	const massParts: string[] = [];
	const dabParts: string[] = [];
	let branchLines = 0;
	for (const branch of skeleton) {
		const appear = smoothstep((t - branch.birth) / appearWindow);
		if (t === 0 || appear <= 0) {
			continue;
		}
		const length = branch.length * appear;
		const x1 = branch.x0 + Math.cos(branch.angle) * length;
		const y1 = branch.y0 + Math.sin(branch.angle) * length;
		const width = Math.max(1.2, branch.thickness * (0.4 + 0.6 * t));
		branchParts.push(`<line x1="${branch.x0.toFixed(2)}" y1="${branch.y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="${species.palette.trunk}" stroke-width="${width.toFixed(2)}" stroke-linecap="round"/>`);
		branchLines++;

		// Canopy fills out as the branch matures; blob scale follows the branch's own progress.
		const blobAppear = smoothstep((t - branch.birth) / (appearWindow + 0.1));
		if (blobAppear > 0) {
			for (const blob of branch.blobs) {
				massParts.push(`<circle cx="${(x1 + blob.dx * appear).toFixed(2)}" cy="${(y1 + blob.dy * appear).toFixed(2)}" r="${(blob.r * blobAppear).toFixed(2)}" fill="${blob.color}"/>`);
			}
			for (const dab of branch.dabs) {
				dabParts.push(`<circle cx="${(x1 + dab.dx * appear).toFixed(2)}" cy="${(y1 + dab.dy * appear).toFixed(2)}" r="${(dab.r * blobAppear).toFixed(2)}" fill="${dab.color}"/>`);
			}
		}
	}
	// Layering: branches under the foliage mass, light dabs over the whole mass.
	const parts = [...branchParts, ...massParts, ...dabParts];

	if (t === 0) {
		// Fresh seed: a little stem and its first leaves.
		parts.push(`<line x1="${centerX}" y1="${groundY}" x2="${centerX}" y2="${groundY - 7}" stroke="${species.palette.trunk}" stroke-width="2.5" stroke-linecap="round"/>`);
		parts.push(`<circle cx="${centerX - 3.5}" cy="${groundY - 9}" r="3" fill="${species.palette.canopy[0]}"/>`);
		parts.push(`<circle cx="${centerX + 3.5}" cy="${groundY - 6}" r="3" fill="${species.palette.canopy[species.palette.canopy.length - 1]}"/>`);
	}

	const ground = `<ellipse cx="${centerX}" cy="${groundY + 3}" rx="26" ry="4" fill="#1e1a16"/>`;

	let defs = "";
	if (options?.active) {
		// Soft glow ring marks the tree receiving tokens.
		defs = `<defs><radialGradient id="glow" cx="0.5" cy="0.6" r="0.5"><stop offset="0" stop-color="#4fa3ff" stop-opacity="0.25"/><stop offset="1" stop-color="#4fa3ff" stop-opacity="0"/></radialGradient></defs>`;
	}

	const glow = options?.active ? `<circle cx="72" cy="72" r="66" fill="url(#glow)"/>` : "";
	return frame(`${defs}<rect width="144" height="144" fill="${backgroundColor}"/>${glow}${ground}${parts.join("")}`);
}

/**
 * Placeholder for a button with no tree yet.
 * @param species Species pre-selected in the inspector, if any, to tint the seed.
 * @returns A full-frame SVG string.
 */
export function soilSvg(species?: TreeSpecies): string {
	const seedColor = species?.palette.trunk ?? "#6b4a2f";
	const inner = [
		`<rect width="144" height="144" fill="${backgroundColor}"/>`,
		`<ellipse cx="${centerX}" cy="${groundY + 2}" rx="30" ry="6" fill="#2a231b"/>`,
		`<ellipse cx="${centerX}" cy="${groundY}" rx="16" ry="3.5" fill="#3a3025"/>`,
		`<circle cx="${centerX}" cy="${groundY - 2}" r="4.5" fill="${seedColor}"/>`,
		`<text x="${centerX}" y="34" font-family="monospace" font-size="14" fill="#9a9a9a" text-anchor="middle">${escapeXml("plant me")}</text>`,
	];
	return frame(inner.join(""));
}

/**
 * Press-overlay frames: the tree with a token badge that fades away.
 * ~9 frames at 3 fps gives a roughly 3 second flash.
 * @param species Resolved species profile.
 * @param seed The tree's shape seed.
 * @param tokens Tokens received so far.
 * @param count Frame count, defaults to 9.
 * @returns One full-frame SVG string per step; the last frame is the plain tree.
 */
export function tokenBadgeFrames(species: TreeSpecies, seed: number, tokens: number, count = 9): string[] {
	const badge = `${compactTokens(tokens)} / ${compactTokens(species.costTokens)}`;
	const width = badge.length * 8 + 16;
	return Array.from({ length: count }, (_, i) => {
		const opacity = 1 - i / (count - 1);
		const badgeSvg = i === count - 1 ? "" : [
			`<rect x="${(72 - width / 2).toFixed(1)}" y="8" width="${width.toFixed(1)}" height="24" rx="6" fill="#000" fill-opacity="${(0.75 * opacity).toFixed(2)}"/>`,
			`<text x="72" y="20" font-family="monospace" font-size="14" fill="#e6e6e6" fill-opacity="${opacity.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${escapeXml(badge)}</text>`,
		].join("");
		// Draw the plain tree, then the badge over it — appending keeps the badge above the background rect.
		const tree = treeSvg(species, seed, tokens);
		return tree.replace("</svg>", `${badgeSvg}</svg>`);
	});
}