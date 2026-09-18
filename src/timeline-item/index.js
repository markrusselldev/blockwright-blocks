/**
 * blockwright/timeline-item - one entry inside a Timeline. Child block (parent-locked). DYNAMIC:
 * stores icon NAME + date/heading/text; render.php resolves the icon via wp_get_icon(). Content
 * edits inline; the marker icon (all collections) is in the sidebar; a Custom SVG overrides it.
 * No-JSX, wp-scripts. save() returns null.
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
	const blockProps = useBlockProps({ className: 'bw-timeline__item' });
	return el(
		Fragment,
		{},
		el(
			InspectorControls,
			{},
			el(
				PanelBody,
				{
					title: __('Timeline entry', 'blockwright-blocks'),
					initialOpen: true,
				},
				el(Control, {
					value: a.icon,
					label: __('Marker icon', 'blockwright-blocks'),
					onChange: (v) => set({ icon: v }),
				}),
				el(TextareaControl, {
					label: __('Custom SVG (advanced)', 'blockwright-blocks'),
					help: __(
						'Paste your own SVG to override the marker icon. Leave blank to use the picked icon.',
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
			el(
				'span',
				{ className: 'bw-timeline__marker' },
				el(Preview, {
					name: a.icon,
					customSvg: a.customSvg,
					className: 'bw-timeline__icon',
				})
			),
			el(
				'div',
				{ className: 'bw-timeline__content' },
				el(RichText, {
					tagName: 'span',
					className: 'bw-timeline__date',
					value: a.date,
					allowedFormats: [],
					onChange: (v) => set({ date: v }),
					placeholder: __('Date or step', 'blockwright-blocks'),
				}),
				el(RichText, {
					tagName: 'h3',
					className: 'bw-timeline__heading',
					value: a.heading,
					allowedFormats: ['core/bold', 'core/italic'],
					onChange: (v) => set({ heading: v }),
					placeholder: __('Heading', 'blockwright-blocks'),
				}),
				el(RichText, {
					tagName: 'p',
					className: 'bw-timeline__text',
					value: a.text,
					allowedFormats: ['core/bold', 'core/italic', 'core/link'],
					onChange: (v) => set({ text: v }),
					placeholder: __(
						'Describe this step.',
						'blockwright-blocks'
					),
				})
			)
		)
	);
}

registerBlockType(metadata.name, { edit: Edit, save: () => null });
