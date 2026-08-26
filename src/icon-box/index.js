/**
 * blockwright/icon-box - Icon Box. DYNAMIC: stores the icon NAME + heading/text/link; render.php
 * resolves the icon via wp_get_icon() and applies block supports via get_block_wrapper_attributes.
 * Icon picked from the shared Control (all collections); a Custom SVG overrides it. No-JSX,
 * wp-scripts. save() returns null.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, RichText, InspectorControls, BlockControls, BlockVerticalAlignmentControl } from '@wordpress/block-editor';
import { PanelBody, SelectControl, TextControl, TextareaControl } from '@wordpress/components';
import { createElement as el, Fragment } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Control, Preview } from '../shared/icon-picker.js';
import metadata from './block.json';

// Vertical alignment only applies when the icon sits beside the content (Left/Right).
const isRow = ( a ) => a.iconPosition === 'left' || a.iconPosition === 'right';

const rootClass = ( a ) =>
	'bw-icon-box is-position-' + ( a.iconPosition || 'top' ) +
	' is-icon-' + ( a.iconSize || 'large' ) +
	( a.alignment === 'center' ? ' is-align-center' : '' ) +
	// No verticalAlignment set = the default optical centring on the heading. An explicit
	// Top/Center/Bottom opts into aligning against the whole card (see style.scss).
	( isRow( a ) && a.verticalAlignment ? ' is-vertically-aligned-' + a.verticalAlignment : '' );

function linkEl( a ) {
	if ( ! a.linkText ) {
		return null;
	}
	return el( 'a', { className: 'bw-icon-box__link', href: a.linkUrl || '#' }, a.linkText );
}

registerBlockType( metadata.name, {
	edit( { attributes: a, setAttributes: set } ) {
		// Pin the grid container to LTR for Left/Right so the icon keeps its physical side in RTL
		// (text direction is reset on the children in style.scss). Inline mirrors render.php.
		const blockProps = useBlockProps( { className: rootClass( a ), style: isRow( a ) ? { direction: 'ltr' } : undefined } );
		return el(
			Fragment,
			{},
			el(
				BlockControls,
				{},
				isRow( a ) &&
					el( BlockVerticalAlignmentControl, {
						// Unset (no button active) = optical centring on the heading (the default);
						// picking one aligns the icon against the whole card.
						value: a.verticalAlignment || undefined,
						onChange: ( v ) => set( { verticalAlignment: v } ),
					} )
			),
			el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __( 'Icon Box', 'blockwright-blocks' ), initialOpen: true },
					el( Control, { value: a.icon, onChange: ( v ) => set( { icon: v } ) } ),
					el( TextareaControl, {
						label: __( 'Custom SVG (advanced)', 'blockwright-blocks' ),
						help: __( 'Paste your own SVG to override the icon above. Leave blank to use the picked icon.', 'blockwright-blocks' ),
						value: a.customSvg,
						onChange: ( v ) => set( { customSvg: v } ),
						__nextHasNoMarginBottom: true,
					} ),
					el( SelectControl, {
						label: __( 'Icon position', 'blockwright-blocks' ),
						value: a.iconPosition,
						options: [
							{ value: 'top', label: __( 'Top (stacked)', 'blockwright-blocks' ) },
							{ value: 'left', label: __( 'Left', 'blockwright-blocks' ) },
							{ value: 'right', label: __( 'Right', 'blockwright-blocks' ) },
						],
						onChange: ( v ) => set( { iconPosition: v } ),
						__nextHasNoMarginBottom: true,
					} ),
					el( SelectControl, {
						label: __( 'Icon size', 'blockwright-blocks' ),
						value: a.iconSize,
						options: [
							{ value: 'x-small', label: __( 'Extra small', 'blockwright-blocks' ) },
							{ value: 'small', label: __( 'Small', 'blockwright-blocks' ) },
							{ value: 'medium', label: __( 'Medium', 'blockwright-blocks' ) },
							{ value: 'large', label: __( 'Large', 'blockwright-blocks' ) },
							{ value: 'x-large', label: __( 'Extra large', 'blockwright-blocks' ) },
						],
						onChange: ( v ) => set( { iconSize: v } ),
						__nextHasNoMarginBottom: true,
					} ),
					// Alignment centers the stacked layout; in a left/right media-object the
					// content is left-aligned by design, so the control only applies to Top.
					a.iconPosition === 'top' &&
						el( SelectControl, {
							label: __( 'Alignment', 'blockwright-blocks' ),
							value: a.alignment,
							options: [
								{ value: 'left', label: __( 'Left', 'blockwright-blocks' ) },
								{ value: 'center', label: __( 'Center', 'blockwright-blocks' ) },
							],
							onChange: ( v ) => set( { alignment: v } ),
							__nextHasNoMarginBottom: true,
						} ),
					el( TextControl, { label: __( 'Link text', 'blockwright-blocks' ), value: a.linkText, onChange: ( v ) => set( { linkText: v } ), __nextHasNoMarginBottom: true } ),
					el( TextControl, { label: __( 'Link URL', 'blockwright-blocks' ), type: 'url', placeholder: 'https://', value: a.linkUrl, onChange: ( v ) => set( { linkUrl: v } ), __nextHasNoMarginBottom: true } )
				)
			),
			el(
				'div',
				blockProps,
				el( Preview, { name: a.icon, customSvg: a.customSvg, className: 'bw-icon-box__icon' } ),
				el(
					'div',
					{ className: 'bw-icon-box__content' },
					el( RichText, { tagName: 'h3', className: 'bw-icon-box__heading', value: a.heading, allowedFormats: [], onChange: ( v ) => set( { heading: v } ), placeholder: __( 'Heading', 'blockwright-blocks' ) } ),
					el( RichText, { tagName: 'p', className: 'bw-icon-box__text', value: a.text, allowedFormats: [ 'core/bold', 'core/italic' ], onChange: ( v ) => set( { text: v } ), placeholder: __( 'Describe this feature or benefit.', 'blockwright-blocks' ) } ),
					linkEl( a )
				)
			)
		);
	},
	save() {
		return null;
	},
} );
