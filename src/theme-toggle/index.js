/**
 * blockwright/theme-toggle - Light / Dark Toggle. Static block: a single <button> holding a sun
 * and a moon glyph; CSS shows the ACTION icon (a moon while the page is light = "switch to dark",
 * a sun while dark = "switch to light"). view.js wires the click and persists the choice in
 * sessionStorage, so the override lasts the visit and the theme returns to the visitor's system
 * setting next time. The sun/moon glyphs are the control's own chrome (inline, fill currentColor).
 * No-JSX, wp-scripts.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { createElement as el } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import metadata from './block.json';

// slug -> Phosphor path data (viewBox 0 0 256 256, fill currentColor).
const ICONS = {
	sun: 'M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z',
	moon: 'M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z',
};

function iconEl( name ) {
	return el(
		'span',
		{ className: 'bw-theme-toggle__icon bw-theme-toggle__icon--' + name },
		el(
			'svg',
			{ xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 256 256', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
			el( 'path', { d: ICONS[ name ] } )
		)
	);
}

function button( blockProps ) {
	return el(
		'button',
		Object.assign( {}, blockProps, {
			type: 'button',
			className: ( blockProps.className || '' ).replace( /\s+/g, ' ' ).trim(),
			'aria-label': __( 'Switch between light and dark colour schemes', 'blockwright-blocks' ),
		} ),
		iconEl( 'sun' ),
		iconEl( 'moon' )
	);
}

registerBlockType( metadata.name, {
	edit() {
		return button( useBlockProps( { className: 'bw-theme-toggle' } ) );
	},
	save() {
		return button( useBlockProps.save( { className: 'bw-theme-toggle' } ) );
	},
} );
