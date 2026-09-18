/**
 * palette-engine.mjs - the deterministic, WCAG-gated color-scheme math for the
 * Blockwright adaptive token palette. ONE source of truth, imported by BOTH the
 * theme's build-time variation generator AND the runtime color tool in wp-admin, so
 * the two cannot drift. Do not fork it.
 *
 * THE MODEL: a scheme is built
 * from ONE seed color. A fixed tonal LIGHTNESS scale (the vetted, accessible structure in
 * RAMP_L) is laid down at the seed's own HUE, and the chroma at each step is the seed's
 * chroma passed through a per-step TAPER (softens the wide-gamut light tints), then
 * gamut-clamped and held under an anti-neon cap. So "seed in, palette out" is a tonal
 * ramp at the seed hue - NOT a hue-rotation of a fixed base (the old method, retired: it
 * went muddy on intrinsically-light hues like gold/amber/lime). One recipe covers the whole
 * wheel, presets and custom brands alike.
 *
 * ROLE TOKENS split by job. The CONTAINER backgrounds (btn-soft/btn-subtle) fold into the ramp as
 * ALIASES (Radix model): they emit `var:preset|color|primary-<step>`, which WP flattens to the
 * concrete value at sanitize time (a palette value that is itself a full `var:preset|color|...`
 * reference resolves to the concrete color). The TEXT/UI roles (link/link-hover/
 * link-active/focus) are generated CONTRAST-FIRST (fitRole): solved to a contrast target at the seed
 * hue, not parked at a fixed ramp lightness (which washed warm hues pale in dark mode). Both
 * kinds stay first-class OVERRIDABLE tokens: a dev sets `link`
 * (etc.) explicitly and it wins; the generated value is only the default (pass spec.roles to override
 * at generation time). ALSO separately computed: `primary` (brandFit - the exact brand), `btn-fill-*`
 * (fitCTA - the brand-hug CTA), `on-primary` (auto ink), `link-visited` (same hue, desaturated), and
 * the semantic families (danger/success/warning).
 *
 * The neutral foundation is tinted toward the seed hue (neutral-tint.mjs), lightness
 * preserved so body-text contrast is unchanged. All values use light-dark() so each look
 * follows the visitor's OS scheme.
 *
 * generateColorVariation() is PURE: give it the theme's foundation palette plus a spec
 * { brandAnchor:{l,c,h}, hue, chroma (cap), vividness?, neutralTint, roles?, strict? } and it
 * returns { palette, checks, report, driven }. It never reads files, writes files, or logs -
 * the build script and the admin UI each do their own I/O around it.
 */
import { rgb, wcagContrast, clampChroma, formatHex, oklch } from 'culori';
import {
	NEUTRAL_TINT,
	isFoundationTintSlug,
	tintFoundation,
} from './neutral-tint.mjs';

export { NEUTRAL_TINT };

// The fixed tonal lightness scale, [lightModeL, darkModeL] per step. Standardized on the
// (slightly darker) gold generator's scale - Mark preferred it, and it reads better in dark.
// This is the accessible structure; the seed only supplies hue + chroma.
export const RAMP_L = {
	50: [0.97, 0.3],
	100: [0.93, 0.35],
	200: [0.88, 0.4],
	300: [0.82, 0.46],
	400: [0.75, 0.55],
	500: [0.68, 0.66],
	600: [0.55, 0.8],
	700: [0.48, 0.85],
	800: [0.4, 0.89],
	900: [0.34, 0.93],
	950: [0.28, 0.96],
};

// Per-step chroma TAPER: soften the LIGHT tints (and, gently, the darkest steps) below the
// gamut so wide-gamut hues (green/lime/yellow) don't get over-saturated tints; blue/violet are
// already gamut-limited there, so the taper leaves them untouched. 1.0 = ride the cap; <1 pulls
// chroma in. Validated in context light+dark 2026-09-10 (proto-seed-build): seed-built ~= the
// old rotated ramps for blue/green/violet, reproduces gold, and adds the light band.
export const CHROMA_TAPER = {
	50: 0.3,
	100: 0.45,
	200: 0.65,
	300: 0.85,
	400: 0.95,
	500: 1,
	600: 1,
	700: 1,
	800: 0.95,
	900: 0.9,
	950: 0.85,
};

// CONTAINER-background role tokens -> ramp step, the DEFAULT alias (a spec.roles override wins).
// These are light TINT backgrounds (or their gated-elsewhere ink), which is exactly the ramp's job,
// so they stay ramp-step aliases (emitted as the WP var: shorthand). btn-soft container =
// 100/200/300 (bg/hover/active) with primary-800 ink; btn-subtle washes = 100/200. See the gate below.
//
// The TEXT/UI role tokens (link, link-hover, link-active, focus) are NOT here: they are generated
// CONTRAST-FIRST (fitRole, below), solved to a contrast target at the seed hue instead of parked at a
// fixed ramp lightness. Parking them washed warm hues pale in dark mode - e.g. link=primary-700 in
// dark mode sat at L 0.85, where red's in-gamut chroma collapses to ~0.08 (pink) even while contrast
// overshot to ~10:1. Solving to the AA floor instead lands the SAME red at a lower L where its
// in-gamut chroma is ~0.19 - a real, on-hue red at 4.5:1.
export const ROLE_ALIAS = {
	'btn-soft-bg': 100,
	'btn-soft-bg-hover': 200,
	'btn-soft-bg-active': 300,
	'btn-soft-text': 800,
	'btn-subtle-bg-hover': 100,
	'btn-subtle-bg-active': 200,
};

// Neutral surface-1 (base neutral-0) each colored token sits on, for contrast checks. Lightness
// mirrors neutral-0 (light 0.99, dark 0.22); hue/chroma come from the per-scheme tint below so
// surfL/surfD equal the surface the site actually paints. Fitting light against pure white (1.0)
// understated contrast: a brand that cleared 3:1 on white sat at ~2.95 on the real 0.99 surface.
export const SURFACE_1 = { light: [0.99, 0.0, 0], dark: [0.22, 0.006, 285.8] };

const toColor = ([l, c, h]) => ({ mode: 'oklch', l, c, h });

// Largest in-gamut chroma for a given L,H in sRGB (clampChroma binary-searches it).
const maxChromaAt = (l, h) =>
	clampChroma({ mode: 'oklch', l, c: 0.4, h }, 'oklch').c ?? 0;

const oklchCss = (o) =>
	`oklch(${+o.l.toFixed(4)} ${+(o.c ?? 0).toFixed(4)} ${+(o.h ?? 0).toFixed(1)})`;

// Contrast in the SAME 8-bit sRGB space the browser paints and WCAG is defined in: quantize
// each color to its rendered hex before measuring. Reasoning in continuous OKLCH overstates
// contrast at a boundary - a brand fitted to a continuous 3.005:1 quantizes to #67a300 on a
// #fbfcfb surface = 2.996:1, a real sub-3.0 miss (caught on the Lime seed, 2026-09-10). So both
// the fit loops and the gate use this, and the engine's numbers match the render + the probe.
const q = (o) => formatHex(rgb(o)) || o;
const ratio = (a, b) => wcagContrast(q(a), q(b));
const AA_TEXT = 4.5;
const BRAND_MIN = 3; // 3:1 large-text / non-text floor for the identity brand color
const BUTTON_MIN = 3; // 3:1 fill-vs-page floor (WCAG 1.4.11) for a solid CTA
const NONTEXT_MIN = 3; // 3:1 for a focus ring / meaningful border
// The CTA label is bold-700 at >=18.66px (theme: button.cta weight 700, fontSize 1.1875rem), which
// is WCAG 2 "large text" (14pt bold) - so its contrast gate is 3:1 (SC 1.4.3), not 4.5:1. This is the
// legal GATE that lets the solid CTA carry a WHITE label on a mid-light brand fill. APCA (advisory)
// then confirms the result is perceptually crisp (every generated white label lands Lc>=60) - it does
// NOT set this threshold and never moves the fill.
const CTA_LABEL_MIN = 3;
const CTA_LABEL_TARGET = 3.05; // deepen to this (small margin over the 3:1 gate against rounding)
// How far, in OKLCH lightness, a dark-mode CTA fill may deepen ON-HUE to carry the white label before
// we fall back to a dark label. Keeps the fill the BRAND color: only intrinsically-light
// dark-mode hues need it, at most ~0.118 (lime); grayscale exceeds the cap and keeps a dark label.
const MAX_CTA_DEEPEN = 0.14;
// APCA is ADVISORY ONLY and lives in the separate check:apca-advisory script - the engine no longer
// uses it (it must never move the fill; WCAG is the only gate here).

// Fit the brand (identity) color for contrast: keep the exact L/C/H where it clears BRAND_MIN
// against `surface`, else move lightness AWAY from the surface along the SAME hue (chroma re-capped
// in-gamut) just until it clears. Returns { obj, adjusted }; adjusted:true means it was moved, so
// the shown color is no longer verbatim in this mode. The ONE source for brand contrast fitting -
// generateColorVariation calls this for `primary`, so the math is not forked.
export const brandFit = (anchor, surface) => {
	let a = clampChroma(
		{ mode: 'oklch', l: anchor.l, c: anchor.c, h: anchor.h },
		'oklch'
	);
	if (ratio(a, surface) >= BRAND_MIN) {
		return { obj: a, adjusted: false };
	}
	const dir = surface.l > 0.5 ? -1 : 1; // move away from the surface
	let L = a.l;
	for (let g = 0; g < 70 && ratio(a, surface) < BRAND_MIN; g++) {
		L = +(L + dir * 0.01).toFixed(4);
		const c = Math.min(anchor.c, maxChromaAt(L, anchor.h));
		a = clampChroma({ mode: 'oklch', l: L, c, h: anchor.h }, 'oklch');
	}
	return { obj: a, adjusted: true };
};

// Ink options for a solid brand fill (CTA label, on-primary): PURE WHITE, or a DARK BRAND-TONED
// shade of the seed hue. The light option is pure white (not a seed-tinted near-white) - that is what
// Radix and the CTA research use for a solid button label, it is measurably crisper (APCA Lc ~67 vs
// ~58 for a 0.96/0.02 tint), and it lets the fill deepen LESS to carry it, keeping the fill closer to
// the brand. The DARK option stays brand-toned (l~0.24, seed hue) for the pale hues that take dark
// text (lime, grayscale in dark). Only the solid FILL uses these; the soft/subtle/outline buttons use
// ramp-shade text (btn-soft-text = primary-800) by design, so this does not touch them.
const darkInk = (hue) =>
	clampChroma(
		{
			mode: 'oklch',
			l: 0.24,
			c: Math.min(0.05, maxChromaAt(0.24, hue)),
			h: hue,
		},
		'oklch'
	);

/**
 * Produce one full adaptive color-variation palette from the theme's foundation palette
 * and a seed spec. Pure.
 *
 * @param {Array}  basePalette Foundation palette entries { slug, name, color }.
 * @param {Object} color       Spec:
 *                             - brandAnchor {l,c,h}  the seed (exact entered / preset color). Drives the ramp hue+chroma
 *                             AND the exact `primary`/`btn-fill` identity. Required in practice;
 *                             if absent the engine falls back to the mid-ramp step as the anchor.
 *                             - hue        number    convenience mirror of brandAnchor.h (kept for callers/back-compat).
 *                             - chroma     number    the anti-neon chroma CAP (e.g. 0.15). 0 = a true grayscale scheme.
 *                             - vividness  number    optional multiplier on the seed chroma for the derived ramp (default 1;
 *                             leaves `primary`/`btn-fill` - the exact brand - untouched).
 *                             - neutralTint {hue,chroma}  the per-scheme neutral tint.
 *                             - roles      object    optional slug->value overrides for the aliased role tokens.
 *                             - strict     boolean   false = drop generated slugs missing from the base palette (runtime,
 *                             theme may lag); default/true = throw (the build must stay in sync).
 * @return {{palette: Array, checks: Array, report: Object, driven: Array}} The full scheme:
 *   the brand family first then the tinted foundation (`palette`), the gated WCAG pairings
 *   (`checks`), an informative non-gated report, and the slugs this scheme actually drives.
 */
export function generateColorVariation(basePalette, color) {
	const cap = color.chroma ?? Infinity;
	const vividness = color.vividness ?? 1;
	const tint = color.neutralTint;

	// Light AND dark surface-1 = the tinted neutral-0 (fixed L, re-hued to the scheme) so every
	// contrast check runs against the surface the site actually paints, not pure white.
	const surfL = toColor([
		SURFACE_1.light[0],
		Math.min(tint.chroma, maxChromaAt(SURFACE_1.light[0], tint.hue)),
		tint.hue,
	]);
	const surfD = toColor([
		SURFACE_1.dark[0],
		Math.min(tint.chroma, maxChromaAt(SURFACE_1.dark[0], tint.hue)),
		tint.hue,
	]);

	// The seed: hue drives the whole ramp; chroma is the tapered source saturation.
	const seedH = ((color.brandAnchor?.h ?? color.hue ?? 240) + 360) % 360;
	const seedC = color.brandAnchor?.c ?? 0;
	// A GRAYSCALE scheme has no real hue (seedC ~ 0; seedH is just the fallback 240). It gets
	// pure-gray inks (else on-fill text reads faintly blue), a MIRRORED identity (below), and a wider
	// visited lightness gap (its only lever, since chroma/hue can't distinguish states).
	const achromatic = seedC < 0.02;

	// Ink pair for this scheme: light = PURE WHITE (crisp solid-button label, Radix model,
	// all schemes incl. grayscale); dark = a very dark shade of the seed hue (brand-toned, neutral for
	// grayscale) for the pale hues that take dark text.
	const INK_LIGHT = { mode: 'oklch', l: 1, c: 0, h: 0 };
	const INK_DARK = achromatic
		? { mode: 'oklch', l: 0.24, c: 0, h: 0 }
		: darkInk(seedH);
	const bestInk = (bg) =>
		ratio(INK_LIGHT, bg) >= ratio(INK_DARK, bg) ? INK_LIGHT : INK_DARK;
	const inkCss = (bg) =>
		bestInk(bg) === INK_LIGHT ? oklchCss(INK_LIGHT) : oklchCss(INK_DARK);

	// --- Seed-built tonal ramp (primary-50..950): the fixed lightness scale at the seed hue,
	// chroma = min(seedChroma * vividness * taper, in-gamut, cap). One recipe, whole wheel. ---
	const gen = {}; // slug -> emitted css value (concrete or a var: alias), overlaid onto base
	const ramp = { light: {}, dark: {} }; // step -> {css,obj} per mode
	// Vividness is bidirectional around 1.0 (the neutral default = the seed's own chroma through the
	// taper). BELOW 1.0 it scales the tapered seed chroma DOWN (a wash). ABOVE 1.0 it interpolates the
	// tapered chroma UP toward the in-gamut edge at that lightness, so a muted seed can be pushed more
	// colorful instead of the control being dead above the seed's own saturation. Either way the
	// anti-neon `cap` and the gamut edge are the hard ceilings. At EXACTLY 1.0 the result is the tapered
	// seed chroma unchanged - so the shipped presets (all generated at vividness 1.0) are byte-identical.
	const rampChroma = (L, step) => {
		const base = seedC * CHROMA_TAPER[step];
		const edge = maxChromaAt(L, seedH);
		const target =
			vividness <= 1
				? base * vividness
				: base + (edge - base) * (vividness - 1);
		return Math.min(target, edge, cap);
	};
	const rampStep = (L, step) => {
		const obj = clampChroma(
			{ mode: 'oklch', l: L, c: rampChroma(L, step), h: seedH },
			'oklch'
		);
		return { css: oklchCss(obj), obj };
	};
	for (const [step, [lL, dL]] of Object.entries(RAMP_L)) {
		ramp.light[step] = rampStep(lL, +step);
		ramp.dark[step] = rampStep(dL, +step);
		gen[`primary-${step}`] =
			`light-dark(${ramp.light[step].css}, ${ramp.dark[step].css})`;
	}

	// --- `primary` = the exact brand color, contrast-fit only where a surface forces it. The
	// anchor is the seed; presets that pass none fall back to the mid-ramp brand shade. A GRAYSCALE
	// scheme has no brand color to preserve (grayscale has no real hue), so its identity MIRRORS
	// per mode - a strong dark gray on light, a strong light gray on dark - instead of pinning a flat
	// mid-gray, so it reads as adaptive like the colored schemes. ---
	const anchorL = color.brandAnchor
		? {
				l: achromatic ? 0.34 : color.brandAnchor.l,
				c: color.brandAnchor.c,
				h: seedH,
			}
		: ramp.light[500].obj;
	const anchorD = color.brandAnchor
		? {
				l: achromatic ? 0.9 : color.brandAnchor.l,
				c: color.brandAnchor.c,
				h: seedH,
			}
		: ramp.dark[500].obj;
	const brandLight = brandFit(anchorL, surfL);
	const brandDark = brandFit(anchorD, surfD);
	const brandObj = { light: brandLight.obj, dark: brandDark.obj };
	gen.primary = `light-dark(${oklchCss(brandLight.obj)}, ${oklchCss(brandDark.obj)})`;

	// on-primary: the legible near-white / near-dark ink for anything painted with the brand.
	gen['on-primary'] =
		`light-dark(${inkCss(brandLight.obj)}, ${inkCss(brandDark.obj)})`;
	const BRAND_NEON = 0.22;
	const brandVivid = color.brandAnchor
		? (color.brandAnchor.c ?? 0) >= BRAND_NEON
		: false;

	// --- CTA fill = the BRAND color ("brand-hug"). The fill IS the exact brand, moved ONLY
	// for a WCAG contrast floor: it must clear 3:1 vs the page (shape), and - since the CTA label is
	// WCAG large text (bold-700 >=18.66px) - it deepens ON-HUE by the smallest move (<=MAX_CTA_DEEPEN)
	// so the preferred WHITE label clears 3:1. Both are WCAG floors. The label is white where it clears
	// that gate, else the dark ink (Radix's auto-label model, for intrinsically-pale hues / grayscale).
	// APCA is ADVISORY ONLY (check:apca-advisory confirms the white labels are perceptually crisp,
	// Lc>=60); it must NEVER set the gate or move the fill - that drift broke the brand-hug rule and our "APCA is
	// not a gate" rule, and is blocked by the check:brand-fill gate. primary/on-primary and btn-fill
	// are all the brand color; the fill may sit a shade deeper than primary in dark mode (Radix: the
	// solid button is a deeper step than the link/text color - same hue, different role). ---
	const brandShadeAt = (anchor, L) =>
		clampChroma(
			{
				mode: 'oklch',
				l: +L.toFixed(4),
				c: Math.min(anchor.c ?? 0, maxChromaAt(L, anchor.h ?? 0)),
				h: anchor.h ?? 0,
			},
			'oklch'
		);
	// The CTA fill is the BRAND color ("brand-hug") and the label is LARGE text (bold-700
	// >=18.66px), so the label gate is 3:1 (CTA_LABEL_MIN), not 4.5. We PREFER the white label (the
	// crisp, on-brand CTA look the research backs): keep the brand at its own lightness when white
	// already clears 3:1, else deepen ON-HUE by the smallest move (capped at MAX_CTA_DEEPEN) until
	// white clears it while the fill still clears 3:1 vs the page. Only when white cannot be reached
	// within the cap (intrinsically-pale hues; grayscale in dark mode) do we fall back to the dark
	// label (Radix's auto-label model). The deepen is a WCAG contrast move, never an APCA one.
	const fitCTA = (anchor, surface) => {
		const fillOkPage = (o) => ratio(o, surface) >= BUTTON_MIN;
		const whiteOk = (o) => ratio(INK_LIGHT, o) >= CTA_LABEL_TARGET;
		const darkOk = (o) => ratio(INK_DARK, o) >= CTA_LABEL_MIN;
		let bg = brandShadeAt(anchor, anchor.l); // the exact brand, chroma re-capped in-gamut

		// 1) Shape floor: a pale brand on a light page must clear 3:1 vs the page. Smallest move.
		if (!fillOkPage(bg)) {
			let best = null;
			let bestDist = Infinity;
			for (let L = 0.2; L <= 0.85; L += 0.005) {
				const o = brandShadeAt(anchor, L);
				if (fillOkPage(o)) {
					const dd = Math.abs(L - anchor.l);
					if (dd < bestDist) {
						bestDist = dd;
						best = o;
					}
				}
			}
			if (best) {
				bg = best;
			}
		}

		// 2) Prefer the WHITE label. If it doesn't clear the large-text gate on the current fill,
		//    deepen on-hue (darker => more contrast with white) up to the cap, keeping the page floor.
		if (!whiteOk(bg)) {
			for (let d = 0.002; d <= MAX_CTA_DEEPEN + 1e-9; d += 0.002) {
				const L = +(bg.l - d).toFixed(4);
				if (L < 0.1) {
					break;
				}
				const o = brandShadeAt(anchor, L);
				if (whiteOk(o) && fillOkPage(o)) {
					bg = o;
					break;
				}
			}
		}

		// 3) Label: white if it now clears the gate; else the dark ink (must clear it); else best of two.
		let ink = bestInk(bg);
		if (whiteOk(bg)) {
			ink = INK_LIGHT;
		} else if (darkOk(bg)) {
			ink = INK_DARK;
		}
		return {
			bg: { css: oklchCss(bg), obj: bg },
			inkObj: ink,
			inkCss:
				ink === INK_LIGHT ? oklchCss(INK_LIGHT) : oklchCss(INK_DARK),
			inkIsLight: ink === INK_LIGHT,
			l: bg.l,
		};
	};
	const ctaFitL = fitCTA(anchorL, surfL);
	const ctaFitD = fitCTA(anchorD, surfD);
	const ctaBg = { light: ctaFitL.bg, dark: ctaFitD.bg };
	// hover/active step toward MORE contrast with the chosen label so it stays legible.
	const emphStep = (anchor, fit, step) => {
		const dir = fit.inkIsLight ? -1 : 1;
		const L = Math.min(0.92, Math.max(0.15, fit.l + dir * step));
		const o = brandShadeAt(anchor, L);
		return { css: oklchCss(o), obj: o };
	};
	const ctaHover = {
		light: emphStep(anchorL, ctaFitL, 0.06),
		dark: emphStep(anchorD, ctaFitD, 0.06),
	};
	const ctaActive = {
		light: emphStep(anchorL, ctaFitL, 0.12),
		dark: emphStep(anchorD, ctaFitD, 0.12),
	};
	gen['btn-fill-bg'] = `light-dark(${ctaBg.light.css}, ${ctaBg.dark.css})`;
	gen['btn-fill-bg-hover'] =
		`light-dark(${ctaHover.light.css}, ${ctaHover.dark.css})`;
	gen['btn-fill-bg-active'] =
		`light-dark(${ctaActive.light.css}, ${ctaActive.dark.css})`;
	gen['btn-fill-text'] = `light-dark(${ctaFitL.inkCss}, ${ctaFitD.inkCss})`;

	// --- brand-fill / on-brand-fill: a STATIC deep shade of the brand for FILLED section
	// backgrounds (the CTA band, any brand-filled section), with its OWN soft near-white ink -
	// kept separate from the media scrim's on-media so the two surfaces tune independently.
	// Unlike the ramp (adaptive), brand-fill is the SAME value in both modes: a filled brand band
	// is a self-contained surface whose legibility is internal (fill vs ink), independent of the
	// page. Deepened on-hue only until the soft near-white clears 4.5:1 for BODY text, so a heading,
	// body copy, and white buttons all pop on it. WCAG is the gate; APCA is advisory (check:apca).
	const ON_BRAND_FILL = { mode: 'oklch', l: 0.97, c: 0, h: 0 };
	const BRAND_FILL_MIN = 4.6; // 4.5 gate + margin, so it clears 4.5 even un-quantized on every hue
	let brandFillBg = brandShadeAt(anchorL, anchorL.l);
	if (ratio(ON_BRAND_FILL, brandFillBg) < BRAND_FILL_MIN) {
		for (let L = anchorL.l; L > 0.1; L -= 0.004) {
			const o = brandShadeAt(anchorL, L);
			if (ratio(ON_BRAND_FILL, o) >= BRAND_FILL_MIN) {
				brandFillBg = o;
				break;
			}
		}
	}
	const brandFillCss = oklchCss(brandFillBg);
	gen['brand-fill'] = `light-dark(${brandFillCss}, ${brandFillCss})`;
	// on-brand-fill is FIXED (soft near-white, same for every scheme), so it is a static config
	// token carried through like on-media - not generated here. ON_BRAND_FILL above is only the
	// target the brand-fill deepening solves against.

	// No btn-fill-border: the CTA is a BORDERLESS solid (the Radix solid-button model). The fill is
	// guaranteed >=3:1 vs the page by fitCTA's shape floor, and the white label >=3:1 on the fill means
	// the fill is >=3:1 vs a white page by symmetry - so a defining edge is redundant. (Dropped 2026-09-12
	// with the large-label white-CTA change; the old darker-edge token existed only for the dark-label
	// bright-fill case, which no longer occurs in light mode.)

	// --- link-visited: the NN/g model - the SAME brand hue as the link, DESATURATED and a touch less
	// luminous so it reads "used" while staying clearly related to the unvisited link. NOT a purple
	// hue-shift: for a branded palette that is the "drastically different color" NN/g warns against,
	// and a 70%-toward-purple blend made every scheme's visited cluster into near-identical plums.
	// Same-hue-duller is distinct PER scheme, brand-cohesive, and rotates no hue (so warm hues never
	// drift to green - the bug the old purple-shift existed to dodge is gone by construction). Gated to
	// 4.5:1 both modes; the vivid-vs-dull luminance/chroma difference is the redundant cue (WCAG
	// use-of-color), alongside the underline + hover states. Source: NN/g "Guidelines for
	// Visualizing Links".
	const visitedH = seedH;
	const linkChroma = Math.min(seedC * vividness * CHROMA_TAPER[700], cap);
	const visitedCap = linkChroma * 0.45; // desaturated "used" wash of the brand hue (0 for Neutral)
	const fitVisited = (surface, startL, dir) => {
		let L = startL;
		let o = clampChroma(
			{
				mode: 'oklch',
				l: L,
				c: Math.min(visitedCap, maxChromaAt(L, visitedH)),
				h: visitedH,
			},
			'oklch'
		);
		for (let g = 0; g < 70 && ratio(o, surface) < AA_TEXT; g++) {
			L = +(L + dir * 0.01).toFixed(4);
			o = clampChroma(
				{
					mode: 'oklch',
					l: L,
					c: Math.min(visitedCap, maxChromaAt(L, visitedH)),
					h: visitedH,
				},
				'oklch'
			);
		}
		return o;
	};
	// (link-visited is computed AFTER the link below, because a near-neutral scheme separates visited
	// from the link by LIGHTNESS and so needs the solved link lightness.)

	const aliasObj = {}; // slug -> {light,dark} obj used for the WCAG gate

	// --- CONTRAST-FIRST text/UI roles (link, link-hover, link-active, focus). Solve for the shade
	// that MEETS a contrast target at the seed hue, instead of parking at a fixed ramp lightness that
	// overshoots into a pale wash. This is fitVisited/fitCTA's proven method generalized. Role chroma
	// = min(seed chroma, in-gamut edge, anti-neon cap): a vivid seed gets a vivid on-hue link, a muted
	// seed (slate/teal) keeps its low-chroma character, grayscale stays achromatic. ---
	const roleChromaAt = (L) => Math.min(seedC, maxChromaAt(L, seedH), cap);
	const roleShadeAt = (L) =>
		clampChroma(
			{ mode: 'oklch', l: +L.toFixed(4), c: roleChromaAt(L), h: seedH },
			'oklch'
		);
	// Least-overshoot solve: from the surface lightness, step AWAY (darker on a light surface, lighter
	// on a dark one) to the FIRST shade that clears `target`. That crossing is the most vivid / most
	// on-hue shade still meeting the target - the opposite of a fixed light step that overshoots pale.
	const L_MIN = 0.04;
	const L_MAX = 0.98;
	const fitRole = (surface, target) => {
		const dir = surface.l > 0.5 ? -1 : 1; // light surface -> step darker; dark surface -> lighter
		let o = roleShadeAt(Math.min(L_MAX, Math.max(L_MIN, surface.l)));
		for (let g = 1; g <= 120; g++) {
			const raw = surface.l + dir * g * 0.01;
			// Stop only at the extreme in the DIRECTION of travel (a light surface travels DOWN toward
			// L_MIN; a dark surface UP toward L_MAX) - not at the near edge the start sits beside, which
			// was tripping on the very first step and returning a near-white/near-black wash.
			const hitExtreme = dir < 0 ? raw <= L_MIN : raw >= L_MAX;
			if (hitExtreme) {
				o = roleShadeAt(Math.min(L_MAX, Math.max(L_MIN, raw)));
				break;
			}
			o = roleShadeAt(raw);
			if (ratio(o, surface) >= target) {
				return o;
			}
		}
		return o; // best effort; the WCAG gate flags it if the target was truly unreachable
	};
	// hover/active step FURTHER from the surface (more contrast, re-capped in-gamut, still on-hue) for
	// a visible interaction change. Monotonic by construction, so both stay >= the link target.
	const ROLE_EMPH_STEP = 0.07; // OKLCH-lightness nudge per state
	const emphRole = (base, surface, n) => {
		const dir = surface.l > 0.5 ? -1 : 1;
		const L = Math.min(
			0.98,
			Math.max(0.04, base.l + dir * n * ROLE_EMPH_STEP)
		);
		return roleShadeAt(L);
	};
	const linkObj = {
		light: fitRole(surfL, AA_TEXT),
		dark: fitRole(surfD, AA_TEXT),
	};

	// link-visited: same brand HUE, desaturated + a step off the link so it reads "used" (NN/g model,
	// not a purple hue-shift). COLORED schemes lean on the hue + the lower chroma to separate visited
	// from the link, so they start a touch further from the surface (0.44 light / 0.8 dark) and the
	// 4.5:1 fit takes over. A NEAR-NEUTRAL scheme (grayscale / slate) has no chroma to differ by, so
	// visited must separate from the link by LIGHTNESS: offset it a clear step FURTHER from the surface
	// than the solved link (darker on light, lighter on dark) - which lands it in the gap between the
	// link and the near-black/near-white body text, distinct from both. (Before this, near-neutral
	// visited fit to the same lightness as the link and rendered identical to it - the slate/grayscale
	// "visited looks like the link/text" bug.) Gated to 4.5:1 both modes; the redundant cue is the
	// lightness gap + underline + hover. Sources: nngroup.com "Guidelines for Visualizing Links".
	const nearNeutral = seedC < 0.06;
	const VISITED_GAP = 0.12; // near-neutral: OKLCH-lightness separation from the solved link
	const visitedLight = fitVisited(
		surfL,
		nearNeutral ? linkObj.light.l - VISITED_GAP : 0.44,
		-1
	);
	const visitedDark = fitVisited(
		surfD,
		nearNeutral ? linkObj.dark.l + VISITED_GAP : 0.8,
		1
	);
	gen['link-visited'] =
		`light-dark(${oklchCss(visitedLight)}, ${oklchCss(visitedDark)})`;
	const hoverObj = {
		light: emphRole(linkObj.light, surfL, 1),
		dark: emphRole(linkObj.dark, surfD, 1),
	};
	const activeObj = {
		light: emphRole(linkObj.light, surfL, 2),
		dark: emphRole(linkObj.dark, surfD, 2),
	};
	// focus is a non-text ring: 3:1 floor + a small margin over quantize/rounding.
	const focusObj = {
		light: fitRole(surfL, NONTEXT_MIN + 0.1),
		dark: fitRole(surfD, NONTEXT_MIN + 0.1),
	};
	// Emit each as a concrete light-dark() value (still OVERRIDABLE: a spec.roles override wins and,
	// if concrete, is what the gate checks). The alias is gone; the contrast guarantee is intrinsic.
	const setRole = (slug, obj) => {
		const override = color.roles?.[slug];
		if (override !== undefined) {
			gen[slug] = override;
			const parsed =
				!String(override).startsWith('var:') &&
				parseLightDark(override);
			aliasObj[slug] = parsed || obj;
		} else {
			gen[slug] =
				`light-dark(${oklchCss(obj.light)}, ${oklchCss(obj.dark)})`;
			aliasObj[slug] = obj;
		}
	};
	setRole('link', linkObj);
	setRole('link-hover', hoverObj);
	setRole('link-active', activeObj);
	setRole('focus', focusObj);

	// --- Container-background role aliases: default to a ramp step (emitted as the WP var: shorthand,
	// which sanitize flattens to the concrete value - verified vs 7.1), unless spec.roles overrides
	// the slug. The alias is the DEFAULT, never a hardcode; a dev override wins. ---
	for (const [slug, step] of Object.entries(ROLE_ALIAS)) {
		const override = color.roles?.[slug];
		gen[slug] = override ?? `var:preset|color|primary-${step}`;
		// Gate against the concrete override if one was given and is parseable; else the ramp step.
		if (override && !String(override).startsWith('var:')) {
			const parsed = parseLightDark(override);
			aliasObj[slug] = parsed ?? {
				light: ramp.light[step].obj,
				dark: ramp.dark[step].obj,
			};
		} else {
			aliasObj[slug] = {
				light: ramp.light[step].obj,
				dark: ramp.dark[step].obj,
			};
		}
	}

	// --- WCAG gate. Links are text (AA 4.5). CTA labels clear 4.5; the fill clears 3:1 vs surface.
	// The Soft container's ramp ink clears 4.5 on all three container tones. Focus clears 3:1
	// (non-text). The brand clears 3:1 (identity large text / UI). ---
	const checkDefs = [
		['link on surface (light)', aliasObj.link.light, surfL, AA_TEXT],
		['link on surface (dark)', aliasObj.link.dark, surfD, AA_TEXT],
		[
			'link-hover on surface (light)',
			aliasObj['link-hover'].light,
			surfL,
			AA_TEXT,
		],
		[
			'link-hover on surface (dark)',
			aliasObj['link-hover'].dark,
			surfD,
			AA_TEXT,
		],
		[
			'link-active on surface (light)',
			aliasObj['link-active'].light,
			surfL,
			AA_TEXT,
		],
		[
			'link-active on surface (dark)',
			aliasObj['link-active'].dark,
			surfD,
			AA_TEXT,
		],
		['link-visited on surface (light)', visitedLight, surfL, AA_TEXT],
		['link-visited on surface (dark)', visitedDark, surfD, AA_TEXT],
		[
			// The CTA label is WCAG large text (bold-700 >=18.66px), so it gates at 3:1, not 4.5.
			'cta label on cta fill (light)',
			ctaFitL.inkObj,
			ctaBg.light.obj,
			CTA_LABEL_MIN,
		],
		[
			'cta label on cta fill (dark)',
			ctaFitD.inkObj,
			ctaBg.dark.obj,
			CTA_LABEL_MIN,
		],
		[
			'button.primary bg vs surface (light)',
			ctaBg.light.obj,
			surfL,
			BUTTON_MIN,
		],
		[
			'button.primary bg vs surface (dark)',
			ctaBg.dark.obj,
			surfD,
			BUTTON_MIN,
		],
		// Soft-container ink (primary-800) on all three container tones (bg/hover/active). The
		// worst case flips per mode (container darkens in light, lightens in dark), so gate all.
		[
			'btn-soft ink on bg (light)',
			aliasObj['btn-soft-text'].light,
			aliasObj['btn-soft-bg'].light,
			AA_TEXT,
		],
		[
			'btn-soft ink on bg (dark)',
			aliasObj['btn-soft-text'].dark,
			aliasObj['btn-soft-bg'].dark,
			AA_TEXT,
		],
		[
			'btn-soft ink on active (light)',
			aliasObj['btn-soft-text'].light,
			aliasObj['btn-soft-bg-active'].light,
			AA_TEXT,
		],
		[
			'btn-soft ink on active (dark)',
			aliasObj['btn-soft-text'].dark,
			aliasObj['btn-soft-bg-active'].dark,
			AA_TEXT,
		],
		['focus vs surface (light)', aliasObj.focus.light, surfL, NONTEXT_MIN],
		['focus vs surface (dark)', aliasObj.focus.dark, surfD, NONTEXT_MIN],
		[
			'brand (primary) vs surface (light)',
			brandObj.light,
			surfL,
			BRAND_MIN,
		],
		['brand (primary) vs surface (dark)', brandObj.dark, surfD, BRAND_MIN],
		[
			'on-primary ink on brand fill (light)',
			bestInk(brandLight.obj),
			brandLight.obj,
			BRAND_MIN,
		],
		[
			'on-primary ink on brand fill (dark)',
			bestInk(brandDark.obj),
			brandDark.obj,
			BRAND_MIN,
		],
	];
	const checks = checkDefs.map(([label, fg, bg, min]) => {
		const r = ratio(fg, bg);
		return { label, ratio: r, min, ok: r >= min };
	});

	// --- Assemble the full palette: the brand family FIRST (WP builds the style-variation
	// preview swatches from the leading entries), then the tinted foundation. ---
	const baseBySlug = new Map(basePalette.map((e) => [e.slug, e]));
	for (const slug of Object.keys(gen)) {
		if (!baseBySlug.has(slug)) {
			// STRICT (build): a generated slug missing from the base palette means the theme
			// fragments and the engine have drifted - fail loudly. LENIENT (runtime, strict:false):
			// the theme may lag the plugin, so drop the slug we can't register and generate the rest.
			if (color.strict === false) {
				delete gen[slug];
				continue;
			}
			throw new Error(
				`Generated slug "${slug}" is not in the base palette (config/theme/settings/color.json).`
			);
		}
	}
	// Lead with the brand color + vivid brand shades so the style-variation previews are not gray.
	const lead = ['primary', 'primary-600', 'primary-500'];
	const genOrder = [
		...lead.filter((s) => s in gen),
		...Object.keys(gen).filter((s) => !lead.includes(s)),
	];
	const genEntries = genOrder.map((slug) => ({
		...baseBySlug.get(slug),
		color: gen[slug],
	}));
	// Foundation tokens (not part of the brand family): tint the neutral ramp / borders /
	// divider / outline toward the seed hue; leave semantics and inks alone.
	const restEntries = basePalette
		.filter((e) => !(e.slug in gen))
		.map((e) =>
			isFoundationTintSlug(e.slug)
				? { ...e, color: tintFoundation(e.color, tint) }
				: e
		);
	const palette = [...genEntries, ...restEntries];

	// --- Informative report (not gated): key pairings + hexes for release notes / the tool. ---
	const hx = (o) => formatHex(rgb(o));
	const report = {
		brand: {
			vivid: brandVivid,
			light: { hex: hx(brandLight.obj), adjusted: brandLight.adjusted },
			dark: { hex: hx(brandDark.obj), adjusted: brandDark.adjusted },
		},
		btnFillL: {
			light: ctaBg.light.obj.l,
			dark: ctaBg.dark.obj.l,
			inkLight: ctaFitL.inkCss,
			inkDark: ctaFitD.inkCss,
			inkLightIsLight: ctaFitL.inkIsLight,
			inkDarkIsLight: ctaFitD.inkIsLight,
		},
		light: {
			brand: hx(brandObj.light),
			link: hx(aliasObj.link.light),
			btn: hx(ctaBg.light.obj),
			pairings: {
				'button.primary bg vs surface-1': ratio(ctaBg.light.obj, surfL),
				'button text on button bg': ratio(
					ctaFitL.inkObj,
					ctaBg.light.obj
				),
				'link vs surface-1': ratio(aliasObj.link.light, surfL),
				'primary-600 vs surface-1': ratio(ramp.light[600].obj, surfL),
			},
		},
		dark: {
			brand: hx(brandObj.dark),
			link: hx(aliasObj.link.dark),
			btn: hx(ctaBg.dark.obj),
			pairings: {
				'button.primary bg vs surface-1': ratio(ctaBg.dark.obj, surfD),
				'button text on button bg': ratio(
					ctaFitD.inkObj,
					ctaBg.dark.obj
				),
				'link vs surface-1': ratio(aliasObj.link.dark, surfD),
				'primary-600 vs surface-1': ratio(ramp.dark[600].obj, surfD),
			},
		},
	};

	// --- Which tokens this scheme actually drives: the brand family, the tinted foundation, and
	// (transitively) anything referencing one of those. Everything else (semantics, fixed inks)
	// is independent of the brand color. ---
	const driven = new Set(Object.keys(gen));
	for (const e of basePalette) {
		if (isFoundationTintSlug(e.slug)) {
			driven.add(e.slug);
		}
	}
	let grew = true;
	while (grew) {
		grew = false;
		for (const e of palette) {
			if (driven.has(e.slug)) {
				continue;
			}
			const refs = [
				...String(e.color).matchAll(
					/(?:preset\|color\||--wp--preset--color--)([a-z0-9-]+)/g
				),
			].map((m) => m[1]);
			if (refs.some((r) => driven.has(r))) {
				driven.add(e.slug);
				grew = true;
			}
		}
	}

	// brandSlugs = exactly the slugs the engine GENERATES this scheme (the brand family: ramp,
	// primary, on-primary, btn-fill/-soft/-subtle, link states, focus). The build caller uses it to
	// overlay the default (Blue) brand onto the base color.json - so the out-of-box look runs the
	// same engine as the variations. Everything NOT in this set is authored foundation / semantics.
	return {
		palette,
		checks,
		report,
		driven: [...driven],
		brandSlugs: Object.keys(gen),
	};
}

// Parse a `light-dark(a, b)` (or bare) oklch/hex value into {light,dark} objs for the gate.
// Used only when a spec.roles override supplies a concrete value; returns null if unparseable.
function parseLightDark(value) {
	const s = String(value).trim();
	const ld = s.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
	if (ld) {
		const l = oklch(ld[1]);
		const d = oklch(ld[2]);
		return l && d ? { light: l, dark: d } : null;
	}
	const o = oklch(s);
	return o ? { light: o, dark: o } : null;
}
