/**
 * blockwright/stamp - a rotated corner badge. Static block; the look lives in style.scss and this
 * maps the editor controls to .bw-stamp classes / CSS vars. Position defaults live in the CSS
 * (token-based); the X/Y sliders only emit inline vars once moved. No-JSX, wp-scripts.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, RichText, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl, RangeControl } from '@wordpress/components';
import { createElement as el, Fragment } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import metadata from './block.json';

// Default offsets (px) matching the CSS fallbacks: X = -xx-small (4), Y = -(x-small + xxx-small) (10).
const DEFAULT_X = -4;
const DEFAULT_Y = -10;

const CORNER_CLASS = { 'top-right': 'bw-stamp--tr', 'top-left': 'bw-stamp--tl', 'bottom-right': 'bw-stamp--br', 'bottom-left': 'bw-stamp--bl' };
const CORNERS = [
	{ label: __( 'Top right', 'blockwright-blocks' ), value: 'top-right' },
	{ label: __( 'Top left', 'blockwright-blocks' ), value: 'top-left' },
	{ label: __( 'Bottom right', 'blockwright-blocks' ), value: 'bottom-right' },
	{ label: __( 'Bottom left', 'blockwright-blocks' ), value: 'bottom-left' },
];
const BORDERS = [
	{ label: __( 'Double', 'blockwright-blocks' ), value: 'double' },
	{ label: __( 'Solid', 'blockwright-blocks' ), value: 'solid' },
	{ label: __( 'Dashed', 'blockwright-blocks' ), value: 'dashed' },
	{ label: __( 'Dotted', 'blockwright-blocks' ), value: 'dotted' },
];

const stampClass = ( a ) => 'bw-stamp ' + ( CORNER_CLASS[ a.corner ] || 'bw-stamp--tr' ) + ' bw-stamp--border-' + ( a.borderType || 'double' );
function stampStyle( a ) {
	const s = { '--bw-stamp-rot': ( a.rotation == null ? 18 : a.rotation ) + 'deg' };
	if ( a.offsetX != null ) {
		s[ '--bw-stamp-x' ] = a.offsetX + 'px';
	}
	if ( a.offsetY != null ) {
		s[ '--bw-stamp-y' ] = a.offsetY + 'px';
	}
	return s;
}

registerBlockType( metadata.name, {
	edit( { attributes: a, setAttributes: set } ) {
		const blockProps = useBlockProps( { className: stampClass( a ), style: stampStyle( a ) } );
		return el(
			Fragment,
			{},
			el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __( 'Stamp', 'blockwright-blocks' ), initialOpen: true },
					el( SelectControl, { label: __( 'Corner', 'blockwright-blocks' ), value: a.corner || 'top-right', options: CORNERS, onChange: ( v ) => set( { corner: v } ), __nextHasNoMarginBottom: true } ),
					el( SelectControl, { label: __( 'Border', 'blockwright-blocks' ), value: a.borderType || 'double', options: BORDERS, onChange: ( v ) => set( { borderType: v } ), __nextHasNoMarginBottom: true } ),
					el( RangeControl, { label: __( 'Rotation (degrees)', 'blockwright-blocks' ), value: a.rotation == null ? 18 : a.rotation, min: -45, max: 45, step: 1, onChange: ( v ) => set( { rotation: v } ), __nextHasNoMarginBottom: true } ),
					el( RangeControl, { label: __( 'Horizontal offset', 'blockwright-blocks' ), help: __( 'Negative overhangs the side edge.', 'blockwright-blocks' ), value: a.offsetX == null ? DEFAULT_X : a.offsetX, min: -40, max: 40, step: 1, onChange: ( v ) => set( { offsetX: v } ), __nextHasNoMarginBottom: true } ),
					el( RangeControl, { label: __( 'Vertical offset', 'blockwright-blocks' ), help: __( 'Negative overhangs the top/bottom edge.', 'blockwright-blocks' ), value: a.offsetY == null ? DEFAULT_Y : a.offsetY, min: -40, max: 40, step: 1, onChange: ( v ) => set( { offsetY: v } ), __nextHasNoMarginBottom: true } )
				)
			),
			el( RichText, Object.assign( {}, blockProps, { tagName: 'p', value: a.text, allowedFormats: [], onChange: ( v ) => set( { text: v } ), placeholder: __( 'Add text', 'blockwright-blocks' ) } ) )
		);
	},
	save( { attributes: a } ) {
		const blockProps = useBlockProps.save( { className: stampClass( a ), style: stampStyle( a ) } );
		return el( RichText.Content, Object.assign( {}, blockProps, { tagName: 'p', value: a.text } ) );
	},
} );
