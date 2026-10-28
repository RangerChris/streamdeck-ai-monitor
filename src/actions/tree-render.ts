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

/** Tip position of a branch at its mature length. */
type Tip = { x: number; y: number };

function tipOf(branch: Branch): Tip {
	return { x: branch.x0 + Math.cos(branch.angle) * branch.length, y: branch.y0 + Math.sin(branch.angle) * branch.length };
}

/** Mixes two #rrggbb colors; t=0 returns a, t=1 returns b. Used to derive crown shades without extra palette entries. */
export function mixHex(a: string, b: string, t: number): string {
	const chan = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
	return `#${[1, 3, 5].map((i) => Math.round(chan(a, i) * (1 - t) + chan(b, i) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Lays the canopy per `canopyStyle`; each style owns a generator shape, sharing
 * only bearer selection and the tip-anchored blob storage. Blobs land at their
 * absolute crown position but ride the nearest bearer's tip, so foliage appears
 * as its branch extends.
 * @param branches The skeleton to crown (mutated in place; the weeper adds twigs).
 * @param species Resolved species profile.
 * @param rng The structure RNG continued from the skeleton build.
 */
function attachCanopy(branches: Branch[], species: TreeSpecies, rng: () => number): void {
	// Canopy starts well inside the crown so the mass fills, not just caps the outer
	// tips. Conifers need foliage up the trunk early or they read as bare red sticks.
	const crownDepth = species.canopyStyle === "blossom" ? 2 : species.canopyStyle === "conifer" ? 1 : species.maxDepth - 2;
	const bearers = branches.filter((b) => b.depth >= crownDepth);
	if (bearers.length === 0) {
		return;
	}
	const tips = bearers.map(tipOf);
	switch (species.canopyStyle) {
		case "pad":
			padCanopy(bearers, tips, species, rng);
			return;
		case "weeper":
			weeperCanopy(branches, bearers, tips, species, rng);
			return;
		case "blossom":
			cloudCanopy(bearers, tips, species, rng, { rAvg: 8, rxFloor: 27, ryFloor: 26, jitter: 0.9, spread: 0.9, shadeMix: 0.35 });
			return;
		case "conifer":
			// Redwood: massive trunk, dense irregular crown — tall and narrow like
			// the cloud styles, not a Christmas-tree triangle.
			cloudCanopy(bearers, tips, species, rng, { rAvg: 6.5, rxFloor: 37, ryFloor: 52, jitter: 0.8, spread: 0.88, rxScale: 0.9, topPad: 8, cellScale: 0.95, shadeMix: 0.35 });
			return;
		case "broadleaf":
			cloudCanopy(bearers, tips, species, rng, { rAvg: 7, rxFloor: 34, ryFloor: 24, jitter: 0.8, spread: 0.9, shadeMix: 0.4 });
			return;
		default:
			cloudCanopy(bearers, tips, species, rng, { rAvg: 7, rxFloor: 27, ryFloor: 26, jitter: 0.8, spread: 0.88 });
	}
}

/** Bounding box of a tip set. */
function tipsExt(tips: Tip[]): { top: number; bottom: number; left: number; right: number } {
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;
	for (const tip of tips) {
		top = Math.min(top, tip.y);
		bottom = Math.max(bottom, tip.y);
		left = Math.min(left, tip.x);
		right = Math.max(right, tip.x);
	}
	return { top, bottom, left, right };
}

/** Pushes a blob whose absolute crown position is (px, py), anchored to the nearest bearer's tip. */
function anchorBlob(bearers: Branch[], tips: Tip[], px: number, py: number, r: number, color: string, layer: "blobs" | "dabs"): void {
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < tips.length; i++) {
		const d = (tips[i].x - px) ** 2 + (tips[i].y - py) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	bearers[best][layer].push({ dx: px - tips[best].x, dy: py - tips[best].y, r, color });
}

/** Tuning for the shared ellipse-grid cloud generator. */
type CloudConf = {
	rAvg: number;
	rxFloor: number;
	ryFloor: number;
	/** Grid jitter as a fraction of the cell. */
	jitter: number;
	/** How far inside the ellipse blob centers may sit (1 = to the rim). */
	spread: number;
	/** Width the crown flares past the bearer tips (rx factor over tip span). */
	rxScale?: number;
	/** How far above the topmost tip the crown envelope starts, covering bare leader tips. */
	topPad?: number;
	/** Grid cell as a factor of rAvg; tighter packs the blobs denser. */
	cellScale?: number;
	/** How strongly the under-shade darkens (0..1). */
	shadeMix?: number;
};

/**
 * The shared crown: a jittered grid of same-color mass blobs inside an envelope
 * ellipse derived from the canopy-bearing tips. Bridging circles merge the
 * scalloped silhouette, and a darker under-coat plus light top dabs give depth.
 */
function cloudCanopy(bearers: Branch[], tips: Tip[], species: TreeSpecies, rng: () => number, conf: CloudConf): void {
	const ext = tipsExt(tips);
	const rx = Math.max(conf.rxFloor, ((ext.right - ext.left) / 2) * (conf.rxScale ?? 1.25) + 5);
	const ry = Math.max(conf.ryFloor, ((ext.bottom - ext.top) / 2) * 0.9 + 19 + (conf.topPad ?? 0));
	const cx = (ext.left + ext.right) / 2;
	const cy = ext.top - (conf.topPad ?? 0) + ry;

	const canopy = species.palette.canopy;
	const shade = mixHex(canopy[0], "#000000", conf.shadeMix ?? 0.3);
	const light = canopy[canopy.length - 1];
	const cell = conf.rAvg * (conf.cellScale ?? 1.25);
	const placed: { px: number; py: number; r: number }[] = [];
	for (let row = 0; row <= Math.ceil((ry * 2) / cell); row++) {
		for (let col = 0; col <= Math.ceil((rx * 2) / cell); col++) {
			const px = cx - rx + col * cell + (rng() - 0.5) * cell * conf.jitter;
			const py = cy - ry + row * cell + (rng() - 0.5) * cell * conf.jitter;
			// Keep centers inside a slightly shrunken ellipse so radii stay in frame.
			const norm = ((px - cx) / (rx * conf.spread)) ** 2 + ((py - cy) / (ry * conf.spread)) ** 2;
			if (norm > 1) {
				continue;
			}
			placed.push({ px, py, r: conf.rAvg * (0.85 + rng() * 0.3) });
		}
	}

	// Mass pass first, then bridge circles fuse the silhouette, then the shade coat.
	for (const p of placed) {
		anchorBlob(bearers, tips, p.px, p.py, p.r, canopy[0], "blobs");
	}
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			const d2 = (placed[i].px - placed[j].px) ** 2 + (placed[i].py - placed[j].py) ** 2;
			if (d2 < (cell * 1.35) ** 2) {
				const r = Math.min(placed[i].r, placed[j].r) * 0.8;
				anchorBlob(bearers, tips, (placed[i].px + placed[j].px) / 2, (placed[i].py + placed[j].py) / 2, r, canopy[0], "blobs");
			}
		}
	}
	for (const p of placed) {
		anchorBlob(bearers, tips, p.px + p.r * 0.18, p.py + p.r * 0.32, p.r * 0.8, shade, "blobs");
	}
	for (const p of placed) {
		anchorBlob(bearers, tips, p.px + p.r * 0.28, p.py - p.r * 0.3, p.r * 0.5, light, "dabs");
		// Accents: blossoms scatter generously, other species drop the odd fruit.
		if (species.palette.accent !== undefined && rng() < (species.canopyStyle === "blossom" ? 0.45 : 0.18)) {
			anchorBlob(bearers, tips, p.px + (rng() - 0.5) * p.r, p.py + (rng() - 0.5) * p.r, p.r * 0.42, species.palette.accent, "dabs");
		}
	}
}

/**
 * Bonsai: each well-separated branch tip carries its own groomed pad — a dense,
 * flattened puff with a light top edge and shaded underside. Pad-per-tip keeps
 * them attached to the branch structure instead of hovering as shelves.
 */
function padCanopy(bearers: Branch[], tips: Tip[], species: TreeSpecies, rng: () => number): void {
	const canopy = species.palette.canopy;
	const shade = mixHex(canopy[0], "#000000", 0.32);
	const light = canopy[canopy.length - 1];
	// Pick pads far apart so each stays a distinct groomed cloud, top tiers first.
	const order = tips.map((tip, i) => i).sort((a, b) => tips[a].y - tips[b].y);
	const chosen: number[] = [];
	for (const i of order) {
		if (chosen.length >= 6) {
			break;
		}
		if (chosen.every((c) => (tips[c].x - tips[i].x) ** 2 + (tips[c].y - tips[i].y) ** 2 >= 169)) {
			chosen.push(i);
		}
	}

	for (const i of chosen) {
		const tip = tips[i];
		const rx = 8 + rng() * 6;
		const ry = 2.4 + rng() * 1.6;
		const padY = -1 - rng() * 2; // pad rests just above its branch tip
		for (let px = -rx; px <= rx; px += 2.6) {
			const half = ry * Math.sqrt(Math.max(0, 1 - (px / (rx * 1.05)) ** 2));
			if (half <= 0) {
				continue;
			}
			const jx = px + (rng() - 0.5) * 1.5;
			const jy = padY + (rng() - 0.5) * half * 1.6;
			const r = 2.7 + rng() * 1.1;
			if (tip.y + jy + r > groundY - 8) {
				continue;
			}
			anchorBlob(bearers, tips, tip.x + jx, tip.y + jy, r, canopy[0], "blobs");
		}
		// Light rim along the top of the pad, shade along its underside.
		for (let px = -rx * 0.85; px <= rx * 0.85; px += 3.4) {
			anchorBlob(bearers, tips, tip.x + px, tip.y + padY - ry * 0.7, 1.9 + rng() * 0.7, light, "dabs");
			anchorBlob(bearers, tips, tip.x + px, tip.y + padY + ry * 0.8, 1.7 + rng() * 0.6, shade, "blobs");
		}
		if (species.palette.accent !== undefined && rng() < 0.5) {
			anchorBlob(bearers, tips, tip.x + (rng() - 0.5) * rx, tip.y + padY + ry, 1.8, species.palette.accent, "dabs");
		}
	}
}

/**
 * Birch: a slender crown of small leaf clusters climbing the upper trunk, with
 * fine twigs left to hang from the branches' outer half — the weeping habit.
 * Twigs are added as real branches so they grow in and droop with the tree.
 */
function weeperCanopy(branches: Branch[], bearers: Branch[], tips: Tip[], species: TreeSpecies, rng: () => number): void {
	const ext = tipsExt(tips);
	const cx = (ext.left + ext.right) / 2;

	const canopy = species.palette.canopy;
	const light = canopy[canopy.length - 1];

	// Foliage clings to the branches as airy clumps around the tips — gaps
	// between the clumps keep the open, wispy birch look instead of a solid lump.
	for (let i = 0; i < bearers.length; i++) {
		if (rng() > 0.88) {
			continue;
		}
		const n = 5 + Math.floor(rng() * 4);
		for (let k = 0; k < n; k++) {
			const dx = (rng() - 0.5) * 11;
			const dy = (rng() - 0.5) * 7;
			const r = 3 + rng() * 1.2;
			anchorBlob(bearers, tips, tips[i].x + dx, tips[i].y + dy, r, canopy[0], "blobs");
		}
		// A light swipe over the top of each clump.
		anchorBlob(bearers, tips, tips[i].x + (rng() - 0.5) * 6, tips[i].y - rng() * 2, 5.5, light, "dabs");
	}

	for (let i = 0; i < bearers.length; i++) {
		const bearer = bearers[i];
		const tip = tips[i];
		const count = rng() < 0.7 ? 1 : 2;
		for (let k = 0; k < count; k++) {
			// Start partway back along the branch so the twig hangs off its outer half.
			const back = 0.25 + rng() * 0.4;
			const sx = tip.x - Math.cos(bearer.angle) * bearer.length * back;
			const sy = tip.y - Math.sin(bearer.angle) * bearer.length * back;
			const outward = (tip.x >= cx ? 1 : -1) * 0.05;
			const angle = Math.PI / 2 + (rng() - 0.5) * 0.3 + outward;
			const length = Math.min(10 + rng() * 9, groundY - 6 - sy);
			if (length < 5) {
				continue;
			}
			const twig: Branch = {
				depth: bearer.depth + 1,
				x0: sx,
				y0: sy,
				angle,
				length,
				thickness: 1,
				birth: Math.min(0.85, bearer.birth + 0.12),
				blobs: [],
				dabs: [],
			};
			for (const f of [0.5, 0.75, 1]) {
				const r = 2.6 + rng() * 1.4;
				const dx = Math.cos(angle) * length * f + (rng() - 0.5) * 1.6;
				const dy = Math.sin(angle) * length * f + (rng() - 0.5) * 1.2;
				twig.blobs.push({ dx, dy, r, color: canopy[0] });
				if (f === 1) {
					twig.dabs.push({ dx, dy: dy - r * 0.4, r: r * 0.5, color: light });
				}
			}
			branches.push(twig);
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
		thickness: (4 + species.heightRatio * 3) * (species.trunkScale ?? 1),
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
 * @param options `count` frame count, defaults to 9.
 * @returns One full-frame SVG string per step; the last frame is the plain tree.
 */
export function tokenBadgeFrames(species: TreeSpecies, seed: number, tokens: number, options?: { count?: number }): string[] {
	const count = options?.count ?? 9;
	const badge = `${compactTokens(tokens)} / ${compactTokens(species.costTokens)}`;
	const width = badge.length * 8 + 16;
	return Array.from({ length: count }, (_, i) => {
		const opacity = 1 - i / (count - 1);
		const badgeSvg = i === count - 1 ? "" : [
			`<rect x="${(72 - width / 2).toFixed(1)}" y="8" width="${width.toFixed(1)}" height="24" rx="6" fill="#000" fill-opacity="${(0.75 * opacity).toFixed(2)}"/>`,
			`<text x="72" y="20" font-family="monospace" font-size="14" fill="#ffffff" fill-opacity="${opacity.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${escapeXml(badge)}</text>`,
		].join("");
		// Draw the plain tree, then the badge over it — appending keeps the badge above the background rect.
		const tree = treeSvg(species, seed, tokens);
		return tree.replace("</svg>", `${badgeSvg}</svg>`);
	});
}