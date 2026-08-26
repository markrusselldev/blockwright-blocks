/**
 * Shared editor helper for the icon-bearing blocks (Icon List, Timeline, Icon Box).
 *
 * The blocks store an icon NAME and resolve it to SVG at RENDER via core's wp_get_icon() - so no
 * SVG is written into post content (no KSES-strip risk) and there is ONE icon system: core's
 * Icons registry.
 *
 * The picker is a visual GRID of the Blockwright collection: it loads the collection once
 * (/wp/v2/icons/blockwright, with SVG content - ~81KB for the curated set, memoised) and shows the
 * icons as clickable buttons, so you browse and see them. This suits a curated set; a
 * search-as-you-type mode is the later add for a large set. In the canvas the chosen icon is shown
 * by Preview, which fetches the single SVG by name; a Custom SVG overrides it.
 */
import { createElement as el, useState, useEffect, RawHTML } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { BaseControl, Button, Spinner, SearchControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const cache = {};
let collectionPromise;

// Load the Blockwright collection once, with SVG content, for the grid.
function loadCollection() {
	if ( collectionPromise ) {
		return collectionPromise;
	}
	collectionPromise = apiFetch( { path: '/wp/v2/icons/blockwright' } )
		.then( ( list ) => {
			list.forEach( ( i ) => { cache[ i.name ] = i.content || ''; } );
			return list;
		} )
		.catch( () => [] );
	return collectionPromise;
}

// The icon-picker GRID is editor-only admin tool UI: it renders in the block inspector and never
// on the front end (the chosen icon renders front-end via the block's tokened style.scss, not
// these objects). So it is styled with WP's ADMIN design vars (--wp-admin-theme-color, the
// components colour scale) plus tool-geometry constants - NOT theme --wp--preset-- tokens, which
// are the wrong semantic layer for a tool's own chrome. The geometry literals carry token-exempt
// (component/tool geometry, the same class our linter already exempts for the timeline marker).
const gridStyle = {
	display: 'grid',
	gridTemplateColumns: 'repeat(auto-fill, minmax(2.25rem, 1fr))', // token-exempt: picker cell size (editor tool UI)
	gap: '2px', // token-exempt: picker grid gap (editor tool UI)
	maxHeight: '15rem', // token-exempt: picker viewport height (editor tool UI)
	overflowY: 'auto',
	padding: '4px', // token-exempt: picker inset (editor tool UI)
	border: '1px solid var(--wp-components-color-gray-300, #ddd)', // token-exempt: WP admin hairline
	borderRadius: '2px', // token-exempt: picker radius (editor tool UI)
};
// Selection uses WP's native `isPressed` button state (below), NOT a hand-rolled ring: a custom
// ring stacked on top of WP's own focus ring when the selected cell was focused, which read as a
// double box. `isPressed` paints the accent fill and is visually distinct from the focus ring, so
// there is only ever one indicator. We must NOT pin `color` here: `isPressed` flips the text to
// white on the dark accent fill, and the glyph's `fill: currentColor` (below) needs to follow it -
// an inline `color: currentColor` would defeat that and render the glyph invisibly dark-on-dark.
const cellStyle = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: '2.25rem', // token-exempt: picker cell size (editor tool UI)
	minWidth: 0,
};
// Flex-centre the inner <svg>: the raw icon markup renders `display:inline`, so it
// baseline-aligns (sits ~2px high) rather than centring in the cell. Centring the wrapper
// puts the glyph dead-centre under the selection ring.
const svgStyle = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: '1.25rem', // token-exempt: picker glyph size (editor tool UI)
	height: '1.25rem', // token-exempt: picker glyph size (editor tool UI)
	fill: 'currentColor',
};

/**
 * Visual grid picker over the Blockwright collection.
 *
 * @param {Object}   props          Props.
 * @param {string}   props.value    Current icon name.
 * @param {Function} props.onChange Called with the chosen icon name.
 * @param {string}   props.label    Control label.
 * @return {WPElement} The grid control.
 */
export function Control( { value, onChange, label } ) {
	const [ icons, setIcons ] = useState( null );
	const [ query, setQuery ] = useState( '' );
	useEffect( () => {
		let cancelled = false;
		loadCollection().then( ( list ) => {
			if ( ! cancelled ) {
				setIcons( list );
			}
		} );
		return () => { cancelled = true; };
	}, [] );

	let body;
	if ( icons === null ) {
		body = el( Spinner );
	} else {
		const q = query.trim().toLowerCase();
		const shown = q ? icons.filter( ( i ) => i.label.toLowerCase().includes( q ) ) : icons;
		body = el(
			'div',
			{},
			// Search filters the grid (browse it, or type to narrow). At a large set this is what
			// keeps the picker usable; the grid stays the primary browse surface.
			el( SearchControl, {
				__nextHasNoMarginBottom: true,
				value: query,
				onChange: setQuery,
				placeholder: __( 'Search icons', 'blockwright-blocks' ),
			} ),
			el(
				'div',
				{ style: gridStyle },
				shown.length
					? shown.map( ( i ) =>
							el(
								Button,
								{
									key: i.name,
									// `label` stays as the accessible name (icon-only button) and the
									// search filter reads it; `showTooltip` is OFF because WP's tooltip
									// popover mispositions inside this scrolling grid (it floated to the
									// top of the panel). Selection = native `isPressed`, so there is one
									// indicator, not our old ring stacked under WP's focus ring.
									label: i.label,
									isPressed: value === i.name,
									onClick: () => onChange( i.name ),
									style: cellStyle,
								},
								el( 'span', { style: svgStyle, dangerouslySetInnerHTML: { __html: i.content } } )
							)
					  )
					: el( 'p', { style: { padding: '8px', margin: 0, opacity: 0.7 } }, __( 'No icons match.', 'blockwright-blocks' ) ) // token-exempt: picker empty-state inset (editor tool UI)
			)
		);
	}

	return el(
		BaseControl,
		{ __nextHasNoMarginBottom: true, label: label || __( 'Icon', 'blockwright-blocks' ) },
		body
	);
}

/**
 * Live icon preview for the editor canvas. Renders a Custom SVG if set, else fetches the chosen
 * icon's SVG by name.
 *
 * @param {Object} props           Props.
 * @param {string} props.name      Icon name, e.g. "blockwright/star".
 * @param {string} props.customSvg Optional raw SVG that overrides the named icon.
 * @param {string} props.className Class for the wrapping <span>.
 * @return {WPElement} The icon span.
 */
export function Preview( { name, customSvg, className } ) {
	const [ svg, setSvg ] = useState( customSvg || cache[ name ] || '' );
	useEffect( () => {
		if ( customSvg ) {
			setSvg( customSvg );
			return;
		}
		if ( ! name ) {
			setSvg( '' );
			return;
		}
		if ( cache[ name ] !== undefined ) {
			setSvg( cache[ name ] );
			return;
		}
		let cancelled = false;
		apiFetch( { path: '/wp/v2/icons/' + name } )
			.then( ( res ) => {
				cache[ name ] = res && res.content ? res.content : '';
				if ( ! cancelled ) {
					setSvg( cache[ name ] );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setSvg( '' );
				}
			} );
		return () => { cancelled = true; };
	}, [ name, customSvg ] );
	return el( 'span', { className }, svg ? el( RawHTML, {}, svg ) : null );
}
