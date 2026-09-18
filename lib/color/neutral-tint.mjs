/**
 * neutral-tint.mjs - per-scheme neutral tinting. The one copy of this math, imported
 * by the theme's build generators and by the runtime admin so they cannot drift.
 *
 * WHY: the base palette ships one cool gray used by every look. A single neutral
 * can't flatter every accent - a cool gray reads faintly blue next to warm gold. So
 * each colored variation tints its neutral foundation TOWARD its own accent: warm
 * gray for Gold, cool for Blue, a hint of green for Green, a hint of violet for
 * Violet. (Radix pairs a specific gray to each accent for the same reason.)
 *
 * HOW: keep every foundation token's LIGHTNESS exactly as the base (so contrast is
 * untouched - WCAG is luminance/L-driven) and only re-cast hue + a small chroma.
 *
 * The chroma is TAPERED by lightness, not flat. A flat chroma tints the big surface
 * fills as much as the mid grays, so light panels drift visibly tan and dark panels
 * drift muddy - the tint stops "staying gray". Instead we scale peak chroma by a
 * bell that is ~0 at white AND black and peaks in the mid grays, matching hand-tuned
 * system grays (Radix sand/sage/slate, Tailwind stone). `chroma` is the PEAK
 * (mid-gray) value; every step gets peak x taper(L), gamut-capped.
 *
 * Applied to the neutral ramp + borders + divider + input outline. Surfaces and
 * text are `var:preset|color|neutral-*` references, so they follow automatically.
 * Semantic families (danger/success/warning) keep their own hues.
 */
import { clampChroma } from 'culori';

// Per-scheme neutral hue (aligned to the accent) + PEAK chroma at the mid grays
// (kept tiny - an order below an accent - so the gray stays gray). Gold is the warm
// one; the cool schemes lean a touch toward their accent.
export const NEUTRAL_TINT = {
	blue: { hue: 258, chroma: 0.01 },
	green: { hue: 158, chroma: 0.01 },
	violet: { hue: 295, chroma: 0.01 },
	gold: { hue: 70, chroma: 0.013 },
	// Neutral: no tint at all - a true gray foundation (the opt-in "back to grayscale" look).
	neutral: { hue: 258, chroma: 0 },
};

// Foundation tokens that carry a literal neutral OKLCH (so they need re-hueing).
export const isFoundationTintSlug = (slug) =>
	/^neutral-/.test(slug) ||
	/^border-/.test(slug) ||
	slug === 'divider' ||
	slug === 'outline-1';

// Chroma-by-lightness shape, ADOPTED from Tailwind's "stone" warm-gray scale (its
// published per-step OKLCH chroma / its 0.013 peak, so peak = 1.0). Near-neutral at
// the light surfaces, peaking in the mid grays, low again at the dark end.
// [lightness, factor], ascending L.
const STONE_PROFILE = [
	[0.147, 0.31],
	[0.216, 0.46],
	[0.268, 0.54],
	[0.374, 0.77],
	[0.444, 0.85],
	[0.553, 1.0],
	[0.709, 0.77],
	[0.869, 0.39],
	[0.923, 0.23],
	[0.985, 0.08],
];
const profileAt = (l) => {
	const p = STONE_PROFILE;
	if (l <= p[0][0]) {
		return p[0][1];
	}
	if (l >= p[p.length - 1][0]) {
		return p[p.length - 1][1];
	}
	for (let i = 1; i < p.length; i++) {
		if (l <= p[i][0]) {
			const [l0, f0] = p[i - 1];
			const [l1, f1] = p[i];
			return f0 + ((f1 - f0) * (l - l0)) / (l1 - l0);
		}
	}
	return p[p.length - 1][1];
};

const maxChromaAt = (l, h) =>
	clampChroma({ mode: 'oklch', l, c: 0.4, h }, 'oklch').c ?? 0;

// Re-cast every oklch(...) in a string toward the tint hue at peak `chroma`, shaped by
// the stone profile and gamut-capped. Lightness + alpha preserved.
const recast = (colorStr, hue, chroma) =>
	colorStr.replace(
		/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(\s*\/\s*[\d.]+)?\s*\)/g,
		(_m, L, _C, _H, alpha) => {
			const l = +L;
			const target = chroma * profileAt(l);
			const c = +Math.min(target, maxChromaAt(l, hue)).toFixed(4);
			const h = +hue.toFixed(1);
			const a = alpha ? alpha.replace(/\s*\/\s*/, ' / ') : '';
			return `oklch(${L} ${c} ${h}${a})`;
		}
	);

/**
 * Re-cast a foundation color toward the tint hue. For a `light-dark(a, b)` pair the
 * dark half is scaled by `darkScale`; the light half uses the full peak. Bare values
 * use the full peak. Stone-profile shaped, lightness/alpha preserved.
 * @param colorStr
 * @param root0
 * @param root0.hue
 * @param root0.chroma
 * @param root0.darkScale
 */
export function tintFoundation(colorStr, { hue, chroma, darkScale = 1 }) {
	const ld = colorStr.match(
		/^light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)$/
	);
	if (ld) {
		return `light-dark(${recast(ld[1], hue, chroma)}, ${recast(
			ld[2],
			hue,
			chroma * darkScale
		)})`;
	}
	return recast(colorStr, hue, chroma);
}
