/**
 * blockwright/stat - Stat Counter. Static block: the number's final value is in save markup
 * (correct with no JS, SEO); view.js progressively enhances it into a count-up. No-JSX, wp-scripts.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, RichText, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, SelectControl, ToggleControl } from '@wordpress/components';
import { createElement as el, Fragment } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import metadata from './block.json';

const rootClass = ( a ) => 'bw-stat' + ( a.alignment === 'left' ? ' is-align-left' : ' is-align-center' );

// The value <p>, identical in edit and save. Final value in text; data-* let view.js animate from 0.
function valueEl( a ) {
	const props = { className: 'bw-stat__value', 'data-value': a.value };
	if ( a.prefix ) {
		props[ 'data-prefix' ] = a.prefix;
	}
	if ( a.suffix ) {
		props[ 'data-suffix' ] = a.suffix;
	}
	if ( a.animate ) {
		props[ 'data-animate' ] = 'true';
	}
	return el( 'p', props, ( a.prefix || '' ) + ( a.value || '' ) + ( a.suffix || '' ) );
}

registerBlockType( metadata.name, {
	edit( { attributes: a, setAttributes: set } ) {
		const blockProps = useBlockProps( { className: rootClass( a ) } );
		return el(
			Fragment,
			{},
			el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __( 'Stat Counter', 'blockwright-blocks' ), initialOpen: true },
					el( TextControl, { label: __( 'Prefix', 'blockwright-blocks' ), value: a.prefix, onChange: ( v ) => set( { prefix: v } ), placeholder: __( 'e.g. $', 'blockwright-blocks' ), __nextHasNoMarginBottom: true } ),
					el( TextControl, { label: __( 'Value', 'blockwright-blocks' ), value: a.value, onChange: ( v ) => set( { value: v } ), __nextHasNoMarginBottom: true } ),
					el( TextControl, { label: __( 'Suffix', 'blockwright-blocks' ), value: a.suffix, onChange: ( v ) => set( { suffix: v } ), placeholder: __( 'e.g. + or %', 'blockwright-blocks' ), __nextHasNoMarginBottom: true } ),
					el( ToggleControl, { label: __( 'Count up when scrolled into view', 'blockwright-blocks' ), checked: a.animate, onChange: ( v ) => set( { animate: v } ), __nextHasNoMarginBottom: true } ),
					el( SelectControl, {
						label: __( 'Alignment', 'blockwright-blocks' ),
						value: a.alignment,
						options: [
							{ value: 'center', label: __( 'Center', 'blockwright-blocks' ) },
							{ value: 'left', label: __( 'Left', 'blockwright-blocks' ) },
						],
						onChange: ( v ) => set( { alignment: v } ),
						__nextHasNoMarginBottom: true,
					} )
				)
			),
			el(
				'div',
				blockProps,
				valueEl( a ),
				el( RichText, { tagName: 'p', className: 'bw-stat__label', value: a.label, allowedFormats: [ 'core/bold', 'core/italic' ], onChange: ( v ) => set( { label: v } ), placeholder: __( 'What this number means', 'blockwright-blocks' ) } )
			)
		);
	},
	save( { attributes: a } ) {
		const blockProps = useBlockProps.save( { className: rootClass( a ) } );
		return el(
			'div',
			blockProps,
			valueEl( a ),
			el( RichText.Content, { tagName: 'p', className: 'bw-stat__label', value: a.label } )
		);
	},
} );
