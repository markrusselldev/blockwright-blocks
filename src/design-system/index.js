/**
 * Design-system control plane - admin screen.
 *
 * One admin page (Appearance -> Design) with a TabPanel shell: an Overview hub plus one tab
 * per ability. Color is the first working module; Typography / Spacing / Autowright are stubbed
 * "coming soon" so the structure users see now is the structure it grows into. TabPanel (not a
 * hand-rolled button strip) gives the ARIA tabs contract for free; tabs stay on one row per the
 * component's own guidance.
 *
 * The Color module: pick a brand color + a few bounded knobs, preview a full accessible scheme
 * live (the shared recipe runs in the browser), and Apply it (which writes theme.json through the
 * server-side write engine, snapshotting first). One-click presets apply the theme's shipped
 * schemes. Below the task, the full palette as a token inventory grouped by role - tonal ramps as
 * horizontal strips, semantic tokens as adaptive split chips, click-to-copy each token's reference
 * - split into what the brand color drives vs what is independent. Restore points (shared across
 * every module) roll any change back and can be deleted.
 */
import {
	createInterpolateElement,
	createRoot,
	forwardRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { useCopyToClipboard, useMergeRefs } from '@wordpress/compose';
import {
	Button,
	Card,
	CardBody,
	ColorPicker,
	Dropdown,
	Modal,
	Panel,
	PanelBody,
	RangeControl,
	TabPanel,
} from '@wordpress/components';
import { chevronDown, chevronUp } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatHex, oklch, clampChroma, wcagContrast } from 'culori';
import { generateColorVariation } from '../../lib/color/palette-engine.mjs';
import './style.scss';

const DATA = window.bwDesignSystem || {};
const BASE_PALETTE = Array.isArray(DATA.basePalette) ? DATA.basePalette : [];
const PRESETS = Array.isArray(DATA.presets) ? DATA.presets : [];
// Presets arranged by COLOR (OKLCH hue) so the chip grid reads as a spectrum sweep; the
// achromatic Grayscale sorts last. Data-driven, so it holds regardless of the PHP order.
const presetHue = (p) => {
	const prim =
		((p.palette || []).find((e) => e.slug === 'primary') || {}).color || '';
	const m = /light-dark\((.+?),/.exec(prim);
	const parsed = oklch((m ? m[1] : prim).trim());
	const c = parsed?.c ?? 0;
	// The two neutrals sort to the END, after the vivid spectrum: Slate (faint chroma) then
	// Grayscale (achromatic) - so a near-gray never lands among the vivid blues.
	if (!parsed || typeof parsed.h !== 'number' || c < 0.02) {
		return 1002; // grayscale (achromatic) - very last
	}
	if (c < 0.06) {
		return 1001; // slate / any faint tinted neutral - just before grayscale
	}
	return parsed.h;
};
const PRESETS_BY_HUE = [...PRESETS].sort((a, b) => presetHue(a) - presetHue(b));
const SITE_URL = typeof DATA.siteUrl === 'string' ? DATA.siteUrl : '';

// A seed with (near) zero chroma has no hue to build a COLORED scheme from - black/white/gray are
// not on the color wheel. We treat such a pick as a request for a NEUTRAL (grayscale) scheme rather
// than falling back to a default hue (which used to turn a black pick into a surprise-blue scheme).
const NEUTRAL_SEED_CHROMA = 0.02;
const isNeutralSeed = (color) => {
	const p = oklch(color);
	return !p || typeof p.h !== 'number' || (p.c ?? 0) < NEUTRAL_SEED_CHROMA;
};

// --- Safe-zone indicator ---------------------------------------------------------------
// The "safe zone" is the OKLCH lightness band where the brand color clears 3:1 on BOTH the
// light and dark surface at once - i.e. it can be used as TEXT (the site title) in either mode
// without any adjustment. Outside it, the brand is shown as a FILL. The surfaces mirror the
// engine's SURFACE_1 so the picture matches what the palette actually does.
const SB_SURF_L = { mode: 'oklch', l: 1, c: 0, h: 0 };
const SB_SURF_D = { mode: 'oklch', l: 0.22, c: 0.006, h: 285.8 };
const SB_LMIN = 0.15;
const SB_LMAX = 0.98;
const safeBand = (hue, chroma) => {
	if (typeof hue !== 'number') {
		return null;
	}
	const c0 = typeof chroma === 'number' ? Math.min(chroma, 0.4) : 0.15;
	let lo = null;
	let hi = null;
	for (let L = 0.2; L <= 0.92; L += 0.01) {
		const c = clampChroma(
			{ mode: 'oklch', l: +L.toFixed(2), c: c0, h: hue },
			'oklch'
		);
		if (
			wcagContrast(c, SB_SURF_L) >= 3 &&
			wcagContrast(c, SB_SURF_D) >= 3
		) {
			if (lo === null) {
				lo = +L.toFixed(2);
			}
			hi = +L.toFixed(2);
		}
	}
	return lo === null ? null : { lo, hi };
};
// Position (% from the TOP of the strip) for a lightness value; the strip runs dark (bottom)
// to light (top).
const sbPct = (L) =>
	((SB_LMAX - Math.min(SB_LMAX, Math.max(SB_LMIN, L))) /
		(SB_LMAX - SB_LMIN)) *
	100;

/**
 * A vertical lightness strip of the current brand hue with the safe zone left bright and
 * everything outside it dimmed, a marker at the current color, and a one-line status.
 * @param {{colorHex: string}} props
 */
// The brand-color-as-body-text indicator: a slim lightness strip (shows how far the entered color
// sits from the usable band) plus, per mode, a small live "Aa" sample of the exact color on that
// surface and its WCAG contrast ratio. >=4.5:1 = usable as body text (AA). The Aa sample carries the
// pass/fail visually - a failing color's "Aa" is washed out - so the green/red on the ratio is only
// reinforcement, never the sole cue (WCAG use-of-color). No badge letters (they collide with "Aa").
function SafeZone({
	colorHex,
	brandLight,
	brandDark,
	adjustedLight,
	adjustedDark,
}) {
	const p = oklch(colorHex) || {};
	const neutral = isNeutralSeed(colorHex);
	const hue = typeof p.h === 'number' ? p.h : null;
	const chroma = typeof p.c === 'number' ? p.c : 0;
	const L = typeof p.l === 'number' ? p.l : 0.66;
	const band = neutral ? null : safeBand(hue, chroma);
	const grad =
		neutral || hue === null
			? 'linear-gradient(to top, oklch(0.2 0 0), oklch(0.98 0 0))'
			: `linear-gradient(to top, oklch(0.2 ${chroma} ${hue}), oklch(0.5 ${chroma} ${hue}), oklch(0.72 ${chroma} ${hue}), oklch(0.95 ${chroma} ${hue}))`;
	// IDENTITY_MIN 3:1 = WCAG's large-text / UI floor, which is what the brand color is used AS: the
	// site title, brand marks, links, and the CTA fill (never body text - that uses the neutral text
	// tokens). >=3 means it is usable as your brand text on that surface; below it, fill-only. The Aa
	// sample carries the state visually, so the green/red on the ratio is reinforcement, never the sole
	// cue (WCAG use-of-color). No badge letters - they would collide with the "Aa" samples.
	//
	// The ratio + Aa measure the SHIPPED `primary` per mode (brandLight/brandDark, post brandFit and
	// the achromatic mirror) - i.e. the color the site ACTUALLY renders - not the raw seed. So a
	// color that gets adjusted for a surface (or a grayscale seed whose identity mirrors per mode)
	// shows its real, legible result instead of a false fail. The STRIP still plots the RAW entered
	// color's lightness, so it shows where your pick sits and why any adjustment happened.
	const IDENTITY_MIN = 3;
	const shipped = {
		light: brandLight || colorHex,
		dark: brandDark || colorHex,
	};
	// State per mode: `adjusted` (brandFit had to move the entered color to stay legible on this
	// surface) wins over pass/fail, because the shipped color it measures ALWAYS clears IDENTITY_MIN
	// - so without this flag an out-of-range pick would read a false green pass. Grayscale never
	// trips it: its identity is mirrored, not fitted, so adjusted is false and it stays a clean pass.
	const modeState = (ratio, adjusted) => {
		if (adjusted) {
			return 'adjusted';
		}
		return ratio >= IDENTITY_MIN ? 'pass' : 'fail';
	};
	const modes = [
		{
			key: 'light',
			bg: '#ffffff',
			color: shipped.light,
			ratio: wcagContrast(shipped.light, SB_SURF_L) || 0,
			state: modeState(
				wcagContrast(shipped.light, SB_SURF_L) || 0,
				!!adjustedLight
			),
		},
		{
			key: 'dark',
			bg: '#1c1c1e',
			color: shipped.dark,
			ratio: wcagContrast(shipped.dark, SB_SURF_D) || 0,
			state: modeState(
				wcagContrast(shipped.dark, SB_SURF_D) || 0,
				!!adjustedDark
			),
		},
	];
	return (
		<div className="bw-ds-safezone">
			<span className="bw-ds-safezone-title">
				{__('WCAG contrast', 'blockwright-blocks')}
			</span>
			<div className="bw-ds-safezone-ind">
				<div
					className="bw-ds-safezone-strip"
					style={{ background: grad }}
				>
					{band && (
						<>
							<div
								className="bw-ds-safezone-dim"
								style={{ top: 0, height: `${sbPct(band.hi)}%` }}
							/>
							<div
								className="bw-ds-safezone-dim"
								style={{ top: `${sbPct(band.lo)}%`, bottom: 0 }}
							/>
						</>
					)}
					<div
						className="bw-ds-safezone-marker"
						style={{ top: `${sbPct(L)}%` }}
					/>
				</div>
				<div className="bw-ds-safezone-modes">
					{modes.map((m) => (
						<div key={m.key} className="bw-ds-mode">
							<span
								className="bw-ds-mode-aa"
								style={{ background: m.bg, color: m.color }}
								aria-hidden="true"
							>
								Aa
							</span>
							<span className={`bw-ds-mode-ratio is-${m.state}`}>
								{m.ratio.toFixed(1)}:1
								{m.state === 'adjusted' && (
									<span className="bw-ds-mode-tag">
										{__('adjusted', 'blockwright-blocks')}
									</span>
								)}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// Seed the picker from the theme's CURRENT brand color (`primary`, the exact entered color),
// so the screen reflects what is ACTUALLY applied on load - including a grayscale
// scheme, which must show as grayscale, not a fake default blue (that made the Color tab
// disagree with the Overview). Only fall back to a default when `primary` is missing or
// unparseable; a genuinely neutral primary is reflected as-is (the picker still opens on a
// usable hue via pickerColor, so it stays pickable).
const DEFAULT_SEED = '#3b6fe0';
const INITIAL_SEED = (() => {
	const acc = BASE_PALETTE.find((e) => e.slug === 'primary');
	if (!acc) {
		return DEFAULT_SEED;
	}
	const ld = String(acc.color).match(/^light-dark\(\s*([^,]+?)\s*,/);
	const value = (ld ? ld[1] : acc.color).trim();
	return formatHex(value) || DEFAULT_SEED;
})();

// The control state a preset stands for. A preset is a baked palette (so curated Gold stays
// exact), but the controls must reflect it: the swatch shows the preset's brand color, the
// Chroma-limit shows the preset's own chroma, and - the important part - `seed` becomes the
// preset's hue so editing a control continues FROM the preset instead of snapping back to the
// previously applied color. Read from `primary` (the preset's exact brand color); every shipped
// preset is full vividness. A grayscale preset (neutral, chroma ~0) rests at the floor.
const presetSpec = (p) => {
	const acc = String(
		(p.palette.find((e) => e.slug === 'primary') || {}).color || ''
	);
	const half = acc.match(/^light-dark\(\s*(.+?)\s*,/);
	const light = (half ? half[1] : acc).trim();
	const parsed = oklch(light);
	const c = parsed && typeof parsed.c === 'number' ? parsed.c : 0.15;
	return {
		seedHex: formatHex(light) || INITIAL_SEED,
		chromaCap: Math.min(0.24, Math.max(0.08, +c.toFixed(2))),
	};
};

const GROUPS = [
	// The vivid brand tokens come first - they move most visibly when the brand color changes, so
	// the colors a user is editing lead the single-column inventory. Then the grayscale foundation:
	// Neutrals (the raw ramp) and its Borders/divider/outline hairlines, then Surfaces and Text.
	// The grays still respond to the scheme - the neutral foundation is tinted toward the accent hue
	// (see neutral-tint.mjs), lightness held so contrast is untouched - which is why they are
	// `driven`, not fixed-meaning; the Grayscale scheme alone leaves them a true gray.
	{
		section: 'driven',
		title: __('Brand & primary ramp', 'blockwright-blocks'),
		desc: __(
			'primary is the exact brand color you entered; primary-50 to 950 is its accessible tonal scale',
			'blockwright-blocks'
		),
		ramp: true,
		match: (s) => /^primary-\d/.test(s) || s === 'primary',
	},
	{
		section: 'driven',
		title: __('Links', 'blockwright-blocks'),
		desc: __('Link text and its states', 'blockwright-blocks'),
		match: (s) => /^link/.test(s),
	},
	{
		section: 'driven',
		title: __('Buttons', 'blockwright-blocks'),
		desc: __('Fill and Soft button fills', 'blockwright-blocks'),
		match: (s) => /^btn-/.test(s),
	},
	{
		section: 'driven',
		title: __('Neutrals', 'blockwright-blocks'),
		desc: __('The gray ramp', 'blockwright-blocks'),
		ramp: true,
		match: (s) => /^neutral-/.test(s),
	},
	{
		section: 'driven',
		title: __('Borders, dividers & focus', 'blockwright-blocks'),
		desc: __(
			'Hairlines, dividers, outlines, focus ring',
			'blockwright-blocks'
		),
		match: (s) =>
			/^border-/.test(s) ||
			s === 'divider' ||
			/^outline-/.test(s) ||
			s === 'focus',
	},
	{
		section: 'driven',
		title: __('Surfaces', 'blockwright-blocks'),
		desc: __('Page and panel backgrounds', 'blockwright-blocks'),
		match: (s) => /^surface-/.test(s),
	},
	{
		section: 'driven',
		title: __('Text', 'blockwright-blocks'),
		desc: __('Body and muted text', 'blockwright-blocks'),
		match: (s) => /^text-/.test(s),
	},
	{
		section: 'independent',
		title: __('Danger', 'blockwright-blocks'),
		desc: __('Error / destructive - fixed meaning', 'blockwright-blocks'),
		ramp: true,
		match: (s) => /^danger/.test(s),
	},
	{
		section: 'independent',
		title: __('Success', 'blockwright-blocks'),
		desc: __(
			'Positive / confirmation - fixed meaning',
			'blockwright-blocks'
		),
		ramp: true,
		match: (s) => /^success/.test(s),
	},
	{
		section: 'independent',
		title: __('Warning', 'blockwright-blocks'),
		desc: __('Caution - fixed meaning', 'blockwright-blocks'),
		ramp: true,
		match: (s) => /^warning/.test(s),
	},
	{
		section: 'independent',
		title: __('Media', 'blockwright-blocks'),
		desc: __('Overlays and text over media', 'blockwright-blocks'),
		match: (s) => s === 'media-scrim' || s === 'on-media',
	},
	{
		section: 'independent',
		title: __('Aliases & misc', 'blockwright-blocks'),
		desc: __('Named aliases and focus ring', 'blockwright-blocks'),
		match: () => true,
	},
];

// Tokens hidden from the reference table (still written on Apply): media-overlay plumbing
// and the literal color aliases - neither is a choice a user reasons about in a color picker.
const HIDDEN_FROM_TABLE = new Set([
	'media-scrim',
	'on-media',
	'on-primary',
	'accent',
	'green',
	'yellow',
	'red',
	'btn-soft-bg',
	'btn-soft-bg-hover',
	'btn-soft-bg-active',
	'btn-soft-text',
	'brand-fill',
]);

const rampNum = (slug) => {
	const m = slug.match(/(\d+)$/);
	return m ? parseInt(m[1], 10) : 0;
};

const buildGroups = (palette) => {
	const seen = new Set();
	const out = [];
	for (const def of GROUPS) {
		let items = palette.filter(
			(e) => !seen.has(e.slug) && def.match(e.slug)
		);
		if (!items.length) {
			continue;
		}
		items.forEach((e) => seen.add(e.slug));
		if (def.ramp) {
			items = [...items].sort(
				(a, b) => rampNum(a.slug) - rampNum(b.slug)
			);
		}
		out.push({ ...def, items });
	}
	return out;
};

// Resolve a token's value for one scheme: pick the light or dark half of a light-dark(),
// then substitute any palette references (var:preset|color|X or var(--wp--preset--color--X))
// with that referenced token's value for the SAME scheme, recursively. Yields a concrete
// CSS color the browser can paint, so surfaces/text (which reference neutrals) show real
// values instead of an undefined variable.
const resolveMode = (color, mode, map, seen) => {
	let s = String(color).trim();
	const ld = s.match(/^light-dark\(\s*(.+?)\s*,\s*(.+)\)$/s);
	if (ld) {
		s = 'light' === mode ? ld[1].trim() : ld[2].trim();
	}
	return s.replace(
		/var:preset\|color\|([a-z0-9-]+)|var\(\s*--wp--preset--color--([a-z0-9-]+)\s*\)/g,
		(m, a, b) => {
			const slug = a || b;
			if (!map[slug] || seen.has(slug)) {
				return m;
			}
			return resolveMode(map[slug], mode, map, new Set([...seen, slug]));
		}
	);
};

const bySlug = (palette) =>
	Object.fromEntries(palette.map((e) => [e.slug, e.color]));

function SampleCard({ scheme, colors }) {
	// The preview shows the brand-carrying elements from the Style Guide (Buttons / Links /
	// Forms), on the light/dark surface (the surface is the canvas). Fixed-meaning tokens
	// (danger/success/warning) are not shown: they never re-hue. Tokens carry var() refs to
	// neutrals, so each is resolved to a concrete color for this scheme.
	const R = (slug) =>
		resolveMode(colors[slug] || 'transparent', scheme, colors, new Set());
	const surface1 = R('surface-1');
	const ink = R('text-1');
	const muted = R('text-2');
	const border = R('border-subtle');
	const divider = R('divider');
	const link = R('link');
	// accent-color / focus ring need a hex: Chromium ignores an oklch() value on native form
	// controls and falls back to the OS default (blue).
	const linkHex = formatHex(link) || link;
	// Soft button = the filled-tonal container (btn-soft-bg) carrying its gated ink (btn-soft-text),
	// matching the theme's is-style-soft exactly - a SOLID tonal step, NOT the old opacity wash.
	const softBg = R('btn-soft-bg');
	const softInk = R('btn-soft-text');
	// A translucent brand wash - used ONLY for the decorative focus glow below (a soft ring is
	// meant to be semi-transparent), never for a button fill.
	const accentTint = `color-mix(in oklab, ${R('primary')} 18%, transparent)`;
	const noop = (e) => e.preventDefault();
	return (
		<div
			className="bw-ds-preview"
			inert=""
			style={{
				colorScheme: scheme,
				background: surface1,
				color: ink,
				borderColor: border,
			}}
		>
			<div className="bw-ds-preview-mode">
				{scheme === 'light'
					? __('Light', 'blockwright-blocks')
					: __('Dark', 'blockwright-blocks')}
			</div>
			<h3 className="bw-ds-preview-h" style={{ color: ink }}>
				{__('The quick brown fox', 'blockwright-blocks')}
			</h3>
			<p className="bw-ds-preview-body" style={{ color: muted }}>
				{createInterpolateElement(
					__(
						'Body copy with an <a1>inline link</a1> and a <a2>visited link</a2> in running text.',
						'blockwright-blocks'
					),
					{
						a1: (
							// eslint-disable-next-line jsx-a11y/anchor-has-content
							<a
								href="#preview"
								style={{ color: link }}
								onClick={noop}
							/>
						),
						a2: (
							// eslint-disable-next-line jsx-a11y/anchor-has-content
							<a
								href="#preview"
								style={{ color: R('link-visited') }}
								onClick={noop}
							/>
						),
					}
				)}
			</p>
			<div
				className="bw-ds-preview-divider"
				style={{ background: divider }}
			/>
			<p className="bw-ds-caption">
				{__(
					'Buttons - Fill / Soft / Outline / Subtle',
					'blockwright-blocks'
				)}
			</p>
			<div className="bw-ds-preview-btns">
				<button
					type="button"
					className="bw-ds-btn"
					style={{
						background: R('btn-fill-bg'),
						color: R('btn-fill-text'),
					}}
				>
					{__('Fill', 'blockwright-blocks')}
				</button>
				<button
					type="button"
					className="bw-ds-btn"
					style={{ background: softBg, color: softInk }}
				>
					{__('Soft', 'blockwright-blocks')}
				</button>
				<button
					type="button"
					className="bw-ds-btn"
					style={{
						background: 'transparent',
						color: link,
						borderColor: link,
					}}
				>
					{__('Outline', 'blockwright-blocks')}
				</button>
				<button
					type="button"
					className="bw-ds-btn"
					style={{ background: 'transparent', color: link }}
				>
					{__('Subtle', 'blockwright-blocks')}
				</button>
			</div>
			<p className="bw-ds-caption">
				{__(
					'Form controls - checkbox, radio, focused field',
					'blockwright-blocks'
				)}
			</p>
			{/* Drawn by us, NOT native <input>: WP admin restyles native checkbox/radio with its
			   own appearance:none + admin-color CSS, so accent-color is ignored and they render
			   admin-blue regardless of scheme. Drawing them guarantees they carry the brand color. */}
			<div className="bw-ds-preview-forms">
				<span className="bw-ds-control" style={{ color: ink }}>
					<span
						className="bw-ds-checkbox"
						style={{ background: R('btn-fill-bg') }}
					>
						{/* fill + its AUTO ink (contrast-guaranteed) so the check is legible in every
						    scheme and mode - a hardcoded white check vanished on the light fills (e.g.
						    the light-mode fill in dark mode). */}
						<svg
							width="9"
							height="9"
							viewBox="0 0 12 12"
							aria-hidden="true"
						>
							<path
								d="M2.5 6.5l2.4 2.4 4.6-5.4"
								fill="none"
								stroke={R('btn-fill-text')}
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
					{__('Checkbox', 'blockwright-blocks')}
				</span>
				<span className="bw-ds-control" style={{ color: ink }}>
					<span
						className="bw-ds-radio"
						style={{ borderColor: R('btn-fill-bg') }}
					>
						<span
							className="bw-ds-radio-dot"
							style={{ background: R('btn-fill-bg') }}
						/>
					</span>
					{__('Radio', 'blockwright-blocks')}
				</span>
				<span
					className="bw-ds-field-sample"
					style={{
						borderColor: linkHex,
						background: surface1,
						color: ink,
						boxShadow: `0 0 0 2px ${accentTint}`,
					}}
				>
					{__('Focused field', 'blockwright-blocks')}
				</span>
			</div>
			<p className="bw-ds-caption">
				{__(
					'Editorial - site title, eyebrow, badge, callout',
					'blockwright-blocks'
				)}
			</p>
			{/* The editorial block styles the theme ships (assets/js/editor-block-styles.js):
			   the brand site title carries the EXACT brand color (primary, identity), the
			   eyebrow the link tone, the badge the Soft tonal pair (btn-soft-bg/-text), and
			   the callout a faint brand tint of the surface with a link left-bar - each
			   resolved to a concrete color for this scheme, matching src/styles/_blocks.scss +
			   theme-base.scss so applying a scheme shows them rendered, not just as chips. */}
			<div className="bw-ds-preview-editorial">
				<div
					className="bw-ds-preview-brand"
					style={{ color: R('primary') }}
				>
					{__('Acme Studio', 'blockwright-blocks')}
				</div>
				<p className="bw-ds-preview-eyebrow" style={{ color: link }}>
					{__('What we do', 'blockwright-blocks')}
				</p>
				<h4 className="bw-ds-preview-eyebrow-h" style={{ color: ink }}>
					{__('Design that adapts', 'blockwright-blocks')}
				</h4>
				<p
					className="bw-ds-preview-badge"
					style={{ background: softBg, color: softInk }}
				>
					{__('New', 'blockwright-blocks')}
				</p>
				<div
					className="bw-ds-preview-callout"
					style={{
						background: `color-mix(in oklab, ${surface1}, ${R('primary')} 12%)`,
						color: ink,
						borderInlineStartColor: link,
					}}
				>
					{__(
						'A callout band draws the eye to a note or aside, tinted with your brand color.',
						'blockwright-blocks'
					)}
				</div>
			</div>
		</div>
	);
}

// The CSS custom property a builder should reference for a token - copied on click. We hand
// over the REFERENCE, never the raw oklch: the values are adaptive light-dark(), so pasting a
// literal would pin one mode and break the adaptiveness. Tailwind copies the value because its
// colors are static; ours are not.
const tokenRef = (slug) => `var(--wp--preset--color--${slug})`;

// Transient "Copied ..." status, announced via an aria-live region. The actual copy is done by
// useCopyToClipboard on each button (see CopyButton); this only tracks the message to show.
function useCopyAnnounce() {
	const [copied, setCopied] = useState('');
	const timer = useRef();
	const announce = useCallback((slug) => {
		setCopied(tokenRef(slug));
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(''), 1600);
	}, []);
	useEffect(() => () => clearTimeout(timer.current), []);
	return { copied, announce };
}

// A click-to-copy button for a token's CSS-var reference. Uses core's useCopyToClipboard (the
// Clipboard API with a textarea/execCommand fallback for non-secure contexts - more robust than a
// bare navigator.clipboard call). forwardRef + useMergeRefs so the clipboard ref composes with any
// ref a caller passes. Callers pass the hover text via a native `title` (see RampStrip/RoleChips).
const CopyButton = forwardRef(function CopyButtonImpl(
	{ slug, announce, children, ...rest },
	forwardedRef
) {
	const copyRef = useCopyToClipboard(
		() => tokenRef(slug),
		() => announce(slug)
	);
	const ref = useMergeRefs([copyRef, forwardedRef]);
	// Spread `...rest` (className/style/title) onto the button; aria-label stays after it so it wins.
	return (
		<button
			ref={ref}
			type="button"
			{...rest}
			aria-label={sprintf(
				/* translators: %s: token slug. */
				__('Copy reference for %s', 'blockwright-blocks'),
				slug
			)}
		>
			{children}
		</button>
	);
});

function GroupHead({ group }) {
	return (
		<div className="bw-ds-group-head">
			<h3 className="bw-ds-group-title">{group.title}</h3>
			<span className="bw-ds-group-desc">
				{group.desc} · {group.items.length}
			</span>
		</div>
	);
}

// A tonal ramp (primitive) as two horizontal strips - light and dark. Primitives are never
// referenced directly in code, so no per-tone values; each segment is click-to-copy and names
// its light/dark values on hover. Compact (one row per mode) so it never opens a layout gap.
function RampStrip({ group, map, announce }) {
	const row = (mode) => (
		<div className="bw-ds-strip-row">
			<span className="bw-ds-strip-lab">
				{'light' === mode
					? __('Light', 'blockwright-blocks')
					: __('Dark', 'blockwright-blocks')}
			</span>
			<div className="bw-ds-strip">
				{group.items.map((e) => {
					const light = resolveMode(e.color, 'light', map, new Set());
					const dark = resolveMode(e.color, 'dark', map, new Set());
					return (
						<CopyButton
							key={e.slug}
							slug={e.slug}
							announce={announce}
							className="bw-ds-sw"
							style={{
								background: 'light' === mode ? light : dark,
							}}
							title={`${e.slug} - ${light} / ${dark}`}
						/>
					);
				})}
			</div>
		</div>
	);
	return (
		<section className="bw-ds-group">
			<GroupHead group={group} />
			<div className="bw-ds-strip2">
				{row('light')}
				{row('dark')}
			</div>
			<div className="bw-ds-strip-ends">
				<span>{group.items[0].slug}</span>
				<span>{group.items[group.items.length - 1].slug}</span>
			</div>
		</section>
	);
}

// Semantic role tokens as adaptive chips: one diagonally-split swatch per token (light half /
// dark half) so the adaptiveness is visible at a glance. Click copies the token reference;
// hover shows both oklch values. No cap - the largest role group is nine chips.
function RoleChips({ group, map, announce }) {
	return (
		<section className="bw-ds-group">
			<GroupHead group={group} />
			{/* Chips are indented (SCSS margin) to align with the ramp bars above; no Light/Dark
			    legend - each chip's swatch is a diagonal split, light top-left / dark bottom-right
			    (consistent orientation), so it's self-descriptive. */}
			<div className="bw-ds-token-chips">
				{group.items.map((e) => {
					const light = resolveMode(e.color, 'light', map, new Set());
					const dark = resolveMode(e.color, 'dark', map, new Set());
					// Drop the redundant "btn-" prefix in the visible label (the group title
					// already says Buttons); the full slug stays in the copied ref and tooltip.
					const label = e.slug.replace(/^btn-/, '');
					return (
						<CopyButton
							key={e.slug}
							slug={e.slug}
							announce={announce}
							className="bw-ds-token-chip"
							title={`${e.slug} - ${__('Light', 'blockwright-blocks')} ${light} · ${__('Dark', 'blockwright-blocks')} ${dark}`}
						>
							<span
								className="bw-ds-token-chip-swatch"
								style={{
									background: `linear-gradient(135deg, ${light} 0 50%, ${dark} 50% 100%)`,
								}}
							/>
							<span className="bw-ds-token-chip-label">
								{label}
							</span>
						</CopyButton>
					);
				})}
			</div>
		</section>
	);
}

function PaletteSection({ title, note, groups, map, announce }) {
	// Ramps as strips, roles as adaptive chips, single column (no ragged gaps). Per-token oklch
	// values live on hover; click a swatch/chip copies its token reference. `announce` (and the one
	// shared copy toast) is owned by ColorModule so both palette sections share a single live region.
	return (
		<div>
			<h2 className="bw-ds-palette-title">{title}</h2>
			<p className="bw-ds-note">{note}</p>
			<div className="bw-ds-groups">
				{groups.map((g) =>
					g.ramp ? (
						<RampStrip
							key={g.title}
							group={g}
							map={map}
							announce={announce}
						/>
					) : (
						<RoleChips
							key={g.title}
							group={g}
							map={map}
							announce={announce}
						/>
					)
				)}
			</div>
		</div>
	);
}

/**
 * Restore points. Fetches on mount and whenever `refreshKey` changes (so a module can refresh it
 * after Apply). Restore reloads the page (the screen re-reads the restored theme). Delete removes a
 * point; the pristine "original" baseline has no delete (the server protects it too).
 * @param root0
 * @param root0.refreshKey
 * @param root0.category   When set (e.g. 'color'), show only THIS module's restore points (plus the
 *                         shared "original" baseline). Omit to show every module's points (Overview).
 */
function RestorePoints({ refreshKey, category }) {
	const [snapshots, setSnapshots] = useState([]);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState(null);
	// Confirm guard: Restore replaces the theme's colors (and reloads) and Delete is permanent, so
	// neither fires on the first click - clicking opens a focus-trapped confirm Modal (below).
	const [confirm, setConfirm] = useState(null); // { id, action: 'restore' | 'delete' }

	const load = useCallback(() => {
		apiFetch({ path: '/blockwright/v1/design/snapshots' })
			.then((s) => setSnapshots(Array.isArray(s) ? s : []))
			.catch(() => {});
	}, []);
	useEffect(() => {
		load();
	}, [load, refreshKey]);

	const restore = async (id) => {
		setBusy(true);
		setErr(null);
		try {
			await apiFetch({
				path: '/blockwright/v1/design/restore',
				method: 'POST',
				data: { id },
			});
			window.location.reload();
		} catch (e) {
			setErr(
				e && e.message
					? e.message
					: __('Restore failed.', 'blockwright-blocks')
			);
			setBusy(false);
		}
	};

	const remove = async (id) => {
		setBusy(true);
		setErr(null);
		try {
			await apiFetch({
				path:
					'/blockwright/v1/design/snapshots/' +
					encodeURIComponent(id),
				method: 'DELETE',
			});
			setConfirm(null);
			load();
		} catch (e) {
			setErr(
				e && e.message
					? e.message
					: __('Delete failed.', 'blockwright-blocks')
			);
		} finally {
			setBusy(false);
		}
	};

	// Display cap = the server's per-module retention (MAX_AUTO_SNAPSHOTS_PER_MODULE): the server
	// keeps the newest 50 auto restore points PER MODULE and permanently prunes older ones of that
	// module, so the list never sprawls and this rarely trims anything. The pristine "original"
	// baseline is always pinned so it stays reachable.
	const CAP = 50;
	// When scoped to a module, show only that module's points (by stored category, with a
	// label-prefix fallback for legacy snapshots that predate the field). The "original" baseline
	// is shared, so it always shows. No category = the Overview's all-modules view.
	const inScope = (s) => {
		if (!category) {
			return true;
		}
		if (s.category) {
			return s.category === category;
		}
		return typeof s.label === 'string'
			? s.label.toLowerCase().startsWith(category.toLowerCase() + ':')
			: false;
	};
	const original = snapshots.find((s) => s.id === 'original.json');
	const recent = snapshots
		.filter((s) => s.id !== 'original.json' && inScope(s))
		.slice(0, CAP);
	const shown = original ? [...recent, original] : recent;

	return (
		<div>
			<div className="bw-ds-sublabel">
				{__('Restore points', 'blockwright-blocks')}
			</div>
			{err && <p className="bw-ds-error">{err}</p>}
			{snapshots.length === 0 ? (
				<p className="bw-ds-empty">
					{__(
						'None yet. Each color scheme you apply becomes a restore point.',
						'blockwright-blocks'
					)}
				</p>
			) : (
				<ul className="bw-ds-restore-list">
					{shown.map((s) => (
						<li key={s.id} className="bw-ds-restore-item">
							<div className="bw-ds-restore-row">
								<span className="bw-ds-ellipsis">
									{s.label || s.id}
								</span>
								<span className="bw-ds-restore-actions">
									<Button
										variant="link"
										disabled={busy}
										onClick={() =>
											setConfirm({
												id: s.id,
												action: 'restore',
											})
										}
										className="bw-ds-linkbtn"
									>
										{__('Restore', 'blockwright-blocks')}
									</Button>
									{'original.json' !== s.id && (
										<Button
											variant="link"
											isDestructive
											disabled={busy}
											onClick={() =>
												setConfirm({
													id: s.id,
													action: 'delete',
												})
											}
											className="bw-ds-linkbtn"
										>
											{__('Delete', 'blockwright-blocks')}
										</Button>
									)}
								</span>
							</div>
							{s.time ? (
								<div className="bw-ds-restore-time">
									{new Date(s.time * 1000).toLocaleString()}
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}
			{snapshots.length > 0 && (
				<p className="bw-ds-hint">
					{sprintf(
						/* translators: %d: number of restore points kept per module. */ __(
							'Keeps the last %d per module; older ones are removed automatically.',
							'blockwright-blocks'
						),
						CAP
					)}
				</p>
			)}
			{/* Confirm in a stable Modal (WP admin confirms destructive actions in a focus-trapped
			   dialog - core uses ConfirmDialog, which is __experimental and banned here, so we build
			   the same alertdialog on the stable Modal primitive). ESC / overlay / Cancel dismiss;
			   focus is trapped and returns to the trigger. The message states the consequence and the
			   confirm button carries the verb (best practice: name the action, not "Are you sure?"). */}
			{confirm && (
				<Modal
					title={
						confirm.action === 'delete'
							? __('Delete restore point', 'blockwright-blocks')
							: __('Restore colors', 'blockwright-blocks')
					}
					onRequestClose={() => setConfirm(null)}
					className="bw-ds-confirm-modal"
					size="small"
				>
					<p className="bw-ds-confirm-modal-text">
						{confirm.action === 'delete'
							? __(
									'This permanently deletes this restore point. It cannot be undone.',
									'blockwright-blocks'
								)
							: __(
									'This replaces your current colors with this restore point and reloads the page.',
									'blockwright-blocks'
								)}
					</p>
					<div className="bw-ds-confirm-modal-actions">
						<Button
							variant="tertiary"
							disabled={busy}
							onClick={() => setConfirm(null)}
						>
							{__('Cancel', 'blockwright-blocks')}
						</Button>
						<Button
							variant="primary"
							isDestructive={confirm.action === 'delete'}
							disabled={busy}
							onClick={() =>
								confirm.action === 'delete'
									? remove(confirm.id)
									: restore(confirm.id)
							}
						>
							{confirm.action === 'delete'
								? __('Delete', 'blockwright-blocks')
								: __('Restore', 'blockwright-blocks')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}

function ColorModule({ onApplied }) {
	const [seed, setSeed] = useState(INITIAL_SEED);
	const [vividness, setVividness] = useState(1.0);
	const [chroma, setChroma] = useState(0.15);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState(null);
	const [snapKey, setSnapKey] = useState(0);
	// A clicked preset loads into the preview (below) without saving; editing any control
	// drops back to the live-generated scheme. Nothing is written until Apply.
	const [preset, setPreset] = useState(null);
	// The "independent of your brand color" inventory is reference-only, collapsed by default.
	const [showIndep, setShowIndep] = useState(false);
	// One copy-to-clipboard status shared by both palette sections (a single aria-live region).
	const { copied, announce } = useCopyAnnounce();
	// "Is there something new to apply?" - the WP Save-button pattern (isDirty). Starts FALSE:
	// on load the tool reflects the already-applied brand color, so Apply reads "Applied" and a
	// no-op apply (which would spawn a junk restore point) is never offered. Any real control or
	// preset change flips it true (the effect below, past the mount guard); Apply success resets it.
	const [dirty, setDirty] = useState(false);

	const result = useMemo(() => {
		if (!BASE_PALETTE.length) {
			return null;
		}
		const parsed = oklch(seed);
		// A near-neutral seed has no hue to build from, so make a true grayscale scheme (chroma
		// clamped to 0) rather than defaulting to a hue - black in, gray out, not surprise-blue.
		const neutral = isNeutralSeed(seed);
		const hue = !neutral && typeof parsed.h === 'number' ? parsed.h : 240;
		const chromaCap = neutral ? 0 : chroma;
		const tintChroma = neutral ? 0 : 0.01;
		try {
			// strict:false - if the active theme's palette lags this plugin (stale theme.json
			// cache, or plugin updated ahead of the theme), generate what we can instead of
			// breaking the whole tool on a slug the older theme has not registered yet.
			// brandAnchor = the EXACT color the user entered. The engine keeps it verbatim for
			// the `primary` (brand) token, adjusting only for contrast - so identity elements
			// (the brand site title) show the actual entered color, not a re-lightened hue.
			const anchorL =
				parsed && typeof parsed.l === 'number' ? parsed.l : 0.66;
			let anchorC = 0.15;
			if (neutral) {
				anchorC = 0;
			} else if (parsed && typeof parsed.c === 'number') {
				anchorC = parsed.c;
			}
			const brandAnchor = { l: anchorL, c: anchorC, h: hue };
			return generateColorVariation(BASE_PALETTE, {
				hue,
				vividness,
				chroma: chromaCap,
				brandAnchor,
				strict: false,
				neutralTint: { hue, chroma: tintChroma },
			});
		} catch (e) {
			return { error: e.message };
		}
	}, [seed, vividness, chroma]);

	// Clear the apply message the instant any control changes, so a stale "Applied" can never
	// sit there making it look like a new change was saved when it was not; and mark the state
	// dirty again so the Apply button returns from "Applied" to actionable.
	const didMount = useRef(false);
	useEffect(() => {
		// Skip the mount run: the initial (already-applied) scheme must not read as dirty; only a
		// control/preset change after load should clear the message and re-enable Apply.
		if (!didMount.current) {
			didMount.current = true;
			return;
		}
		setMsg(null);
		setDirty(true);
	}, [seed, vividness, chroma, preset]);
	// And auto-dismiss it after a few seconds even if nothing changes.
	useEffect(() => {
		if (!msg) {
			return undefined;
		}
		const t = setTimeout(
			() => setMsg(null),
			'ok' === msg.type ? 6000 : 10000
		);
		return () => clearTimeout(t);
	}, [msg]);

	const applyPalette = async (palette, label) => {
		setBusy(true);
		setMsg(null);
		try {
			await apiFetch({
				path: '/blockwright/v1/design/apply',
				method: 'POST',
				data: { category: 'color', palette, label },
			});
			setMsg({
				type: 'ok',
				text: __(
					'Applied, and a restore point was saved.',
					'blockwright-blocks'
				),
			});
			setDirty(false);
			setSnapKey((k) => k + 1);
			// Push the applied palette up so the Overview (and anything showing the CURRENT theme
			// palette) updates without a page reload - the page-load palette is now stale.
			if (onApplied) {
				onApplied(palette);
			}
		} catch (e) {
			setMsg({
				type: 'error',
				text:
					e && e.message
						? e.message
						: __('Apply failed.', 'blockwright-blocks'),
			});
		} finally {
			setBusy(false);
		}
	};

	if (result && result.error) {
		return (
			<p>
				{sprintf(
					// translators: %s: technical error detail from the color engine.
					__(
						'Could not generate the color scheme: %s',
						'blockwright-blocks'
					),
					result.error
				)}
			</p>
		);
	}

	const activePalette = preset ? preset.palette : result.palette;
	const colors = bySlug(activePalette);
	// The brand swatch + hex reflect the ACTIVE brand color: the preset's accent when a preset
	// is chosen (else the last seed the swatch stays stale on a green preset while showing blue).
	const swatchValue = (() => {
		if (!preset) {
			return seed;
		}
		const acc = String(colors.primary || '');
		const half = acc.match(/^light-dark\(\s*(.+?)\s*,/);
		return formatHex(half ? half[1].trim() : acc) || seed;
	})();
	// The color fed to the PICKER (react-colorful) is ALWAYS the true current color, so the
	// picker matches the swatch chip. On a grayscale scheme this is a pure gray, which
	// react-colorful parses to hue 0 (any achromatic color has no hue). Its saturation SQUARE
	// paints backgroundColor: hsl(hue,100%,50%), so at hue 0 the square glows RED behind a gray -
	// a rendering artifact, not a wrong value. We neutralize that square via the `is-achromatic`
	// class below (keeping the WP-standard control); it drops the moment chroma rises off gray.
	const pickerColor = swatchValue;
	const pickerNeutral = isNeutralSeed(pickerColor);
	const rawMap = colors; // slug -> raw color (with references), for per-mode resolution
	const failing = preset ? [] : result.checks.filter((c) => !c.ok);
	// A custom near-neutral pick makes a grayscale scheme (no hue to build from); note it so the
	// user understands why - a preset (incl. Grayscale) is a deliberate choice, so no note there.
	const seedNeutral = !preset && isNeutralSeed(seed);
	// Heads-up notes for a custom brand pick: whether the exact color had to be nudged for
	// contrast in a mode (we tell them the fitted hex, not silently change it), and whether the
	// pick is near-neon. We NEVER desaturate the brand color - the note just explains.
	const brandNotes = (() => {
		const b = result && result.report && result.report.brand;
		if (preset || seedNeutral || !b) {
			return [];
		}
		const out = [];
		if (b.light.adjusted && b.dark.adjusted) {
			out.push(
				sprintf(
					// translators: 1: light-mode hex, 2: dark-mode hex.
					__(
						'This color is low-contrast on both backgrounds, so light mode uses %1$s and dark mode uses %2$s to stay legible.',
						'blockwright-blocks'
					),
					b.light.hex,
					b.dark.hex
				)
			);
		} else if (b.light.adjusted) {
			out.push(
				sprintf(
					// translators: %s is the darkened hex used in light mode.
					__(
						'Too light to read on a light background, so light mode uses %s (your exact color is kept in dark mode).',
						'blockwright-blocks'
					),
					b.light.hex
				)
			);
		} else if (b.dark.adjusted) {
			out.push(
				sprintf(
					// translators: %s is the lightened hex used in dark mode.
					__(
						'Too dark to read on a dark background, so dark mode uses %s (your exact color is kept in light mode).',
						'blockwright-blocks'
					),
					b.dark.hex
				)
			);
		}
		if (b.vivid) {
			out.push(
				__(
					'Very saturated (near-neon) - it will look vivid. Pick a less saturated color if you want to tone it down (Colorfulness only affects the derived shades, not your exact brand color).',
					'blockwright-blocks'
				)
			);
		}
		return out;
	})();
	const drivenSet = new Set(result.driven || []);
	// Internal plumbing not worth showing in a color PICKER: the media-overlay tokens
	// (scrim / text-over-media) and the literal color aliases. They stay in the applied
	// palette (activePalette is what Apply writes) - this only trims the reference TABLE.
	const tablePalette = activePalette.filter(
		(e) => !HIDDEN_FROM_TABLE.has(e.slug)
	);
	// Section a token by whether it ACTUALLY re-hues (the engine's driven set), not by a slug
	// guess - so brand-driven aliases like focus/primary sit under "Changes with your brand
	// color", and only fixed-meaning tokens stay "Independent". (GROUPS' own `section` field is
	// now just documentation; the split is driven by this partition.)
	const drivenGroups = buildGroups(
		tablePalette.filter((e) => drivenSet.has(e.slug))
	);
	const indepGroups = buildGroups(
		tablePalette.filter((e) => !drivenSet.has(e.slug))
	);

	return (
		<div className="bw-ds-color">
			{/* Controls: a compact rail that stays in view while the inventory scrolls. */}
			<div className="bw-ds-rail">
				<div className="bw-ds-field">
					<div className="bw-ds-field-head">
						<span className="bw-ds-label">
							{__('Brand color', 'blockwright-blocks')}
						</span>
						<code className="bw-ds-hex">{swatchValue}</code>
					</div>
					{/* A WP ColorPicker in a Dropdown, NOT a native <input type=color>: the native
					   OS color dialog swallows the first outside-click, so Apply needed two clicks.
					   The Dropdown is a DOM popover we control and the picker commits live, so Apply
					   takes the first click. */}
					<div className="bw-ds-swatch-row">
						<Dropdown
							className="bw-color-dropdown"
							popoverProps={{ placement: 'bottom-start' }}
							renderToggle={({ isOpen, onToggle }) => (
								<button
									type="button"
									onClick={onToggle}
									aria-expanded={isOpen}
									aria-haspopup="dialog"
									aria-label={__(
										'Choose brand color',
										'blockwright-blocks'
									)}
									className="bw-ds-swatch-toggle"
									style={{ background: swatchValue }}
								/>
							)}
							renderContent={({ onClose }) => (
								<div
									className={`bw-ds-picker-pop${
										pickerNeutral ? ' is-achromatic' : ''
									}`}
								>
									<ColorPicker
										color={pickerColor}
										enableAlpha={false}
										onChange={(c) => {
											setSeed(c);
											setPreset(null);
										}}
									/>
									{/* The picker commits live (onChange), so this only dismisses - but an
								    explicit Done is clearer than relying on click-away/Escape alone. */}
									<Button
										variant="primary"
										onClick={onClose}
										className="bw-ds-picker-done"
									>
										{__('Done', 'blockwright-blocks')}
									</Button>
								</div>
							)}
						/>
						<SafeZone
							colorHex={swatchValue}
							brandLight={result?.report?.brand?.light?.hex}
							brandDark={result?.report?.brand?.dark?.hex}
							adjustedLight={
								result?.report?.brand?.light?.adjusted
							}
							adjustedDark={result?.report?.brand?.dark?.adjusted}
						/>
					</div>
					{!preset && (
						<p className="bw-ds-seed-note">
							{seedNeutral
								? __(
										'A near-neutral color has no hue to build from, so this makes a grayscale scheme. Pick a more saturated color for a colored one.',
										'blockwright-blocks'
									)
								: __(
										'Select a color to build the palette.',
										'blockwright-blocks'
									)}
						</p>
					)}
					{!preset && !seedNeutral && brandNotes.length > 0 && (
						<p className="bw-ds-seed-warn">
							{brandNotes.join(' ')}
						</p>
					)}
				</div>
				<RangeControl
					label={__('Colorfulness', 'blockwright-blocks')}
					help={__(
						'Saturation of the generated shades, up to the Chroma limit.',
						'blockwright-blocks'
					)}
					value={vividness}
					onChange={(v) => {
						setVividness(v);
						setPreset(null);
					}}
					min={0.6}
					max={1.5}
					step={0.05}
					marks={[{ value: 1.0, label: '' }]}
					showTooltip={false}
					__nextHasNoMarginBottom
				/>
				<Panel className="bw-advanced">
					<PanelBody
						title={__('Advanced', 'blockwright-blocks')}
						initialOpen={false}
					>
						<RangeControl
							label={__('Chroma limit', 'blockwright-blocks')}
							help={__(
								'Ceiling that keeps vivid hues (greens, reds, violets) from going neon. Softer hues like gold or teal never reach it.',
								'blockwright-blocks'
							)}
							value={chroma}
							onChange={(v) => {
								setChroma(v);
								setPreset(null);
							}}
							min={0.08}
							max={0.24}
							step={0.01}
							showTooltip={false}
							__nextHasNoMarginBottom
						/>
					</PanelBody>
				</Panel>
				{PRESETS.length > 0 && (
					<div className="bw-ds-presets">
						<div className="bw-ds-sublabel">
							{__('Or start from a preset', 'blockwright-blocks')}
						</div>
						<div className="bw-ds-preset-list">
							{PRESETS_BY_HUE.map((p) => {
								// Each preset is a named tile showing a few of the scheme's colors (WordPress's own
								// style-variation preview shows up to five), with a text name for accessibility. A scheme is
								// several colors, not one. All light-dark(), so the preview follows the viewer's OS.
								const tok = (slug) =>
									(
										p.palette.find(
											(e) => e.slug === slug
										) || {}
									).color;
								const brand =
									tok('primary') || tok('btn-fill-bg');
								const deep = tok('link') || tok('primary-700');
								const tint =
									tok('primary-100') || tok('btn-soft-bg');
								return (
									<Button
										key={p.slug}
										className="bw-ds-preset"
										isPressed={
											!!preset && preset.title === p.title
										}
										disabled={busy}
										onClick={() => {
											// Sync the controls to the preset so the swatch/Chroma
											// reflect it and a later edit continues from its hue.
											const { seedHex, chromaCap } =
												presetSpec(p);
											setSeed(seedHex);
											setChroma(chromaCap);
											setVividness(1.0);
											setPreset(p);
											setMsg(null);
										}}
									>
										<span
											className="bw-ds-preset-preview"
											aria-hidden="true"
										>
											<span
												style={
													tint
														? { background: tint }
														: undefined
												}
											/>
											<span
												style={
													brand
														? { background: brand }
														: undefined
												}
											/>
											<span
												style={
													deep
														? { background: deep }
														: undefined
												}
											/>
										</span>
										<span className="bw-ds-preset-name">
											{p.title}
										</span>
									</Button>
								);
							})}
						</div>
					</div>
				)}
				<div className="bw-ds-apply-row">
					<Button
						variant="primary"
						onClick={() =>
							applyPalette(
								activePalette,
								preset ? preset.title : seed
							)
						}
						isBusy={busy}
						disabled={
							busy || !dirty || (!preset && failing.length > 0)
						}
					>
						{!dirty
							? __('Applied', 'blockwright-blocks')
							: sprintf(
									/* translators: %s: preset name, or the brand color as a hex code. */
									__('Apply %s', 'blockwright-blocks'),
									// Preset: its name. Custom: the seed as hex (formatHex normalizes
									// rgb() or any other picker format to a short #hex); falls back to
									// the raw seed.
									preset
										? preset.title
										: formatHex(seed) || seed
								)}
					</Button>
					{/* Guard: a custom seed the engine cannot gate to AA disables Apply. Unreachable
					    with today's controls (they stay on the accessible ramp), but kept for a future
					    per-token-editing path where a user could pick a failing pairing - so the
					    disabled button explains itself instead of disabling silently. */}
					{!preset && failing.length > 0 && (
						<span className="bw-ds-apply-note">
							{__(
								'This combination cannot meet WCAG AA - adjust the color or chroma.',
								'blockwright-blocks'
							)}
						</span>
					)}
				</div>
				{msg && (
					<p
						className={
							'bw-ds-msg ' +
							(msg.type === 'ok' ? 'is-ok' : 'is-error')
						}
					>
						<span className="bw-ds-msg-text">{msg.text}</span>
						{msg.type === 'ok' && SITE_URL && (
							<a
								className="bw-ds-msg-link"
								href={SITE_URL}
								target="_blank"
								rel="noreferrer noopener"
							>
								{__('View your site', 'blockwright-blocks')} ↗
							</a>
						)}
						<Button
							variant="link"
							onClick={() => setMsg(null)}
							className="bw-ds-linkbtn"
							aria-label={__('Dismiss', 'blockwright-blocks')}
						>
							{__('Dismiss', 'blockwright-blocks')}
						</Button>
					</p>
				)}
				<div className="bw-ds-rail-section">
					<RestorePoints refreshKey={snapKey} category="color" />
				</div>
			</div>

			{/* Output: the live preview and the full token inventory. */}
			<div className="bw-ds-output">
				<div className="bw-ds-section-head">
					<h2 className="bw-ds-h2">
						{__('Preview', 'blockwright-blocks')}
					</h2>
					<span className="bw-ds-muted">
						{__(
							'Your color scheme in context, light and dark. Text and controls always meet WCAG AA.',
							'blockwright-blocks'
						)}
					</span>
				</div>
				<div className="bw-ds-samples">
					<SampleCard scheme="light" colors={colors} />
					<SampleCard scheme="dark" colors={colors} />
				</div>
				<div className="bw-ds-block-top">
					<PaletteSection
						title={__(
							'Changes with your brand color',
							'blockwright-blocks'
						)}
						note={__(
							'The tokens the controls drive - re-hued from your seed, or derived from the tinted neutrals.',
							'blockwright-blocks'
						)}
						groups={drivenGroups}
						map={rawMap}
						announce={announce}
					/>
				</div>
				<div className="bw-ds-indep">
					<Button
						variant="link"
						icon={showIndep ? chevronUp : chevronDown}
						iconPosition="right"
						onClick={() => setShowIndep((v) => !v)}
						className="bw-ds-indep-toggle"
					>
						{showIndep
							? __(
									'Hide colors independent of your brand color',
									'blockwright-blocks'
								)
							: __(
									'Show colors independent of your brand color',
									'blockwright-blocks'
								)}
					</Button>
					{showIndep && (
						<div className="bw-ds-indep-body">
							<PaletteSection
								title={__(
									'Independent of your brand color',
									'blockwright-blocks'
								)}
								note={__(
									'Reference only. Fixed meanings (a red error stays red) the settings do not change.',
									'blockwright-blocks'
								)}
								groups={indepGroups}
								map={rawMap}
								announce={announce}
							/>
						</div>
					)}
				</div>
				<div
					className={'bw-ds-copy-toast' + (copied ? ' is-on' : '')}
					role="status"
					aria-live="polite"
				>
					{copied &&
						sprintf(
							/* translators: %s: the copied CSS variable reference. */
							__('Copied %s', 'blockwright-blocks'),
							copied
						)}
				</div>
			</div>
		</div>
	);
}

/**
 * A little strip of the current theme's palette, for the Overview card.
 * @param root0
 * @param root0.palette
 */
function OverviewSwatches({ palette }) {
	const map = bySlug(palette);
	const slugs = [
		'primary',
		'link',
		'primary-600',
		'surface-2',
		'text-1',
	].filter((s) => map[s]);
	const show = slugs.length
		? slugs
		: BASE_PALETTE.slice(0, 5).map((e) => e.slug);
	return (
		<div className="bw-ds-swatch-strip">
			{show.map((s) => (
				<span
					key={s}
					title={s}
					className="bw-ds-mini-swatch"
					style={{
						background: resolveMode(
							map[s] || 'transparent',
							'light',
							map,
							new Set()
						),
					}}
				/>
			))}
		</div>
	);
}

function ModuleCard({ title, desc, children }) {
	return (
		<Card size="small" className="bw-ds-module-card">
			<CardBody>
				<h3 className="bw-ds-card-title">{title}</h3>
				{desc && <p className="bw-ds-card-desc">{desc}</p>}
				{children}
			</CardBody>
		</Card>
	);
}

function Overview({ onOpenColor, themePalette }) {
	return (
		<div>
			<div className="bw-ds-cards">
				<ModuleCard
					title={
						<>
							{__('Color', 'blockwright-blocks')}{' '}
							<span className="bw-ds-chip is-ready">
								{__('Ready', 'blockwright-blocks')}
							</span>
						</>
					}
					desc={__(
						'Pick a brand color and generate a full, accessible, adaptive light/dark palette. Apply it to your theme.',
						'blockwright-blocks'
					)}
				>
					<OverviewSwatches palette={themePalette} />
					<Button variant="primary" onClick={onOpenColor}>
						{__('Open Color', 'blockwright-blocks')}
					</Button>
				</ModuleCard>
				<ModuleCard
					title={
						<>
							{__('Typography', 'blockwright-blocks')}{' '}
							<span className="bw-ds-chip is-soon">
								{__('Coming soon', 'blockwright-blocks')}
							</span>
						</>
					}
					desc={__(
						'Type families and a fluid type scale for headings and body, previewed live in context.',
						'blockwright-blocks'
					)}
				/>
				<ModuleCard
					title={
						<>
							{__('Spacing', 'blockwright-blocks')}{' '}
							<span className="bw-ds-chip is-soon">
								{__('Coming soon', 'blockwright-blocks')}
							</span>
						</>
					}
					desc={__(
						'Tune the fluid spacing scale and rhythm every block and pattern inherits.',
						'blockwright-blocks'
					)}
				/>
			</div>
			<div className="bw-ds-overview-grid">
				<Card size="small">
					<CardBody>
						<p className="bw-ds-restore-intro">
							{__(
								'Every change across any module saves a restore point here. Roll back or clear old ones.',
								'blockwright-blocks'
							)}
						</p>
						<RestorePoints />
					</CardBody>
				</Card>
				<Card size="small">
					<CardBody>
						<h3 className="bw-ds-card-title">
							{__('Autowright', 'blockwright-blocks')}{' '}
							<span className="bw-ds-chip is-soon">
								{__('Coming soon', 'blockwright-blocks')}
							</span>
						</h3>
						<p className="bw-ds-card-desc is-flush">
							{__(
								'Your design assistant: describe the feel you want and let it propose a color scheme, using your own provider key. Every suggestion still runs through the same accessible, reversible apply.',
								'blockwright-blocks'
							)}
						</p>
					</CardBody>
				</Card>
			</div>
		</div>
	);
}

function ComingSoon({ title, blurb }) {
	return (
		<div className="bw-ds-comingsoon">
			<p className="bw-ds-comingsoon-title">
				{sprintf(
					/* translators: %s: module name. */ __(
						'%s is coming soon',
						'blockwright-blocks'
					),
					title
				)}
			</p>
			<p className="bw-ds-comingsoon-blurb">{blurb}</p>
		</div>
	);
}

const TABS = [
	{ name: 'overview', title: __('Overview', 'blockwright-blocks') },
	{ name: 'color', title: __('Color', 'blockwright-blocks') },
	{ name: 'type', title: __('Typography', 'blockwright-blocks') },
	{ name: 'space', title: __('Spacing', 'blockwright-blocks') },
	{ name: 'autowright', title: __('Autowright', 'blockwright-blocks') },
];

function App() {
	// TabPanel is uncontrolled, so "Open Color" jumps tabs by remounting it with a new
	// initialTabName (bumping the key). Normal tab clicks do not remount.
	const [initialTab, setInitialTab] = useState('overview');
	const [tabKey, setTabKey] = useState(0);
	// The CURRENT applied theme palette, so the Overview reflects an Apply without a page reload
	// (seeded from the page-load palette, updated in place when the Color module applies).
	const [themePalette, setThemePalette] = useState(BASE_PALETTE);
	const openColor = () => {
		setInitialTab('color');
		setTabKey((k) => k + 1);
	};

	if (!BASE_PALETTE.length) {
		return (
			<p>
				{__(
					'This screen needs a Blockwright-style theme active (it reads the theme palette).',
					'blockwright-blocks'
				)}
			</p>
		);
	}

	return (
		<div className="bw-ds-app">
			<TabPanel
				key={tabKey}
				className="bw-design-tabs"
				tabs={TABS}
				initialTabName={initialTab}
			>
				{(tab) => (
					<div className="bw-ds-tabpanel-body">
						{'overview' === tab.name && (
							<Overview
								onOpenColor={openColor}
								themePalette={themePalette}
							/>
						)}
						{'color' === tab.name && (
							<ColorModule onApplied={setThemePalette} />
						)}
						{'type' === tab.name && (
							<ComingSoon
								title={__('Typography', 'blockwright-blocks')}
								blurb={__(
									'Type families and a fluid type scale for headings and body, built on the same token engine and previewed live in light and dark.',
									'blockwright-blocks'
								)}
							/>
						)}
						{'space' === tab.name && (
							<ComingSoon
								title={__('Spacing', 'blockwright-blocks')}
								blurb={__(
									'A fluid spacing scale and vertical rhythm every block and pattern inherits, tuned from one place.',
									'blockwright-blocks'
								)}
							/>
						)}
						{'autowright' === tab.name && (
							<ComingSoon
								title={__('Autowright', 'blockwright-blocks')}
								blurb={__(
									'Your design assistant: describe the look you want and get a proposed color scheme, using your own provider key so no credentials pass through us. Every suggestion runs through the same accessible, reversible apply as the manual controls.',
									'blockwright-blocks'
								)}
							/>
						)}
					</div>
				)}
			</TabPanel>
		</div>
	);
}

const root = document.getElementById('bw-design-system-root');
if (root) {
	createRoot(root).render(<App />);
}
