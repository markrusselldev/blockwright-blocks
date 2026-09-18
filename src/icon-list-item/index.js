/**
 * blockwright/icon-list-item - one icon + text row inside an Icon List.
 *
 * Child block (parent-locked, hidden from the inserter). DYNAMIC: stores the icon NAME + text;
 * render.php resolves the icon via wp_get_icon(). The icon is picked from the shared Control
 * (all collections, searchable) and previewed via apiFetch; a Custom SVG overrides it. No-JSX,
 * built with @wordpress/scripts. save() returns null.
 */
import { registerBlockType } from '@wordpress/blocks';
import {
	useBlockProps,
	RichText,
	InspectorControls,
} from '@wordpress/block-editor';
import { PanelBody, TextareaControl } from '@wordpress/components';
import { createElement as el, Fragment } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Control, Preview } from '../shared/icon-picker.js';
import metadata from './block.json';

function Edit({ attributes: a, setAttributes: set }) {
	const blockProps = useBlockProps({ className: 'bw-icon-list__item' });
	return el(
		Fragment,
		{},
		el(
			InspectorControls,
			{},
			el(
				PanelBody,
				{
					title: __('List item', 'blockwright-blocks'),
					initialOpen: true,
				},
				el(Control, {
					value: a.icon,
					onChange: (v) => set({ icon: v }),
				}),
				el(TextareaControl, {
					label: __('Custom SVG (advanced)', 'blockwright-blocks'),
					help: __(
						'Paste your own SVG to override the icon above. Leave blank to use the picked icon.',
						'blockwright-blocks'
					),
					value: a.customSvg,
					onChange: (v) => set({ customSvg: v }),
					__nextHasNoMarginBottom: true,
				})
			)
		),
		el(
			'li',
			blockProps,
			el(Preview, {
				name: a.icon,
				customSvg: a.customSvg,
				className: 'bw-icon-list__icon',
			}),
			el(RichText, {
				tagName: 'span',
				className: 'bw-icon-list__text',
				value: a.text,
				allowedFormats: ['core/bold', 'core/italic', 'core/link'],
				onChange: (v) => set({ text: v }),
				placeholder: __('List item', 'blockwright-blocks'),
			})
		)
	);
}

registerBlockType(metadata.name, { edit: Edit, save: () => null });
