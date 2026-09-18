/**
 * blockwright/icon-list - Icon List (parent container).
 *
 * Parent/child pair mirroring core/list + core/list-item: this block is the <ul>, each row is a
 * blockwright/icon-list-item nested via InnerBlocks. Static block (save reproduces the <ul> +
 * InnerBlocks.Content). No-JSX (createElement), built with @wordpress/scripts.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import {
	useBlockProps,
	useInnerBlocksProps,
	InnerBlocks,
} from '@wordpress/block-editor';
import { createElement as el } from '@wordpress/element';
import metadata from './block.json';

const ALLOWED = ['blockwright/icon-list-item'];
const TEMPLATE = [
	['blockwright/icon-list-item', { text: 'First list item' }],
	['blockwright/icon-list-item', { text: 'Second list item' }],
	['blockwright/icon-list-item', { text: 'Third list item' }],
];

function Edit() {
	const blockProps = useBlockProps({ className: 'bw-icon-list' });
	const innerProps = useInnerBlocksProps(blockProps, {
		allowedBlocks: ALLOWED,
		template: TEMPLATE,
		templateLock: false,
		orientation: 'vertical',
	});
	return el('ul', innerProps);
}

function save() {
	const blockProps = useBlockProps.save({ className: 'bw-icon-list' });
	return el('ul', blockProps, el(InnerBlocks.Content));
}

registerBlockType(metadata.name, { edit: Edit, save });
