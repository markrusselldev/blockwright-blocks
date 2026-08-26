/**
 * blockwright/timeline - Timeline (parent container). Parent/child pair like core/list; this is
 * the <ol>, each entry a blockwright/timeline-item nested via InnerBlocks. No-JSX, wp-scripts.
 */
import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, useInnerBlocksProps, InnerBlocks } from '@wordpress/block-editor';
import { createElement as el } from '@wordpress/element';
import metadata from './block.json';

const ALLOWED = [ 'blockwright/timeline-item' ];
const TEMPLATE = [
	[ 'blockwright/timeline-item', { date: 'Step one', heading: 'Discovery', text: 'What happens first.' } ],
	[ 'blockwright/timeline-item', { date: 'Step two', heading: 'Build', text: 'What happens next.' } ],
	[ 'blockwright/timeline-item', { date: 'Step three', heading: 'Launch', text: 'How it finishes.' } ],
];

registerBlockType( metadata.name, {
	edit() {
		const blockProps = useBlockProps( { className: 'bw-timeline' } );
		const innerProps = useInnerBlocksProps( blockProps, {
			allowedBlocks: ALLOWED,
			template: TEMPLATE,
			templateLock: false,
			orientation: 'vertical',
		} );
		return el( 'ol', innerProps );
	},
	save() {
		const blockProps = useBlockProps.save( { className: 'bw-timeline' } );
		return el( 'ol', blockProps, el( InnerBlocks.Content ) );
	},
} );
