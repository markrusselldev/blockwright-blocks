<?php
/**
 * Register the plugin's custom blocks.
 *
 * Blocks are authored under src/<slug>/ and built with @wordpress/scripts to build/<slug>/
 * (index.js + index.asset.php with auto-detected dependencies, style-index.css, block.json, and
 * any render.php / view.js). register_block_type() reads each built block.json: it registers the
 * editor script using the generated index.asset.php (so dependencies and version are automatic -
 * no manual wp_register_script), the on-demand style/viewScript, and the render.php for dynamic
 * blocks. Icon-bearing blocks bundle the shared editor picker (src/shared/icon-picker.js) via an
 * import, so there is no separate script to register here.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\Blocks;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'init',
	function () {
		// One slug per shipped block. Scaffold new blocks with scripts/new-block.mjs.
		$blocks = array(
			'icon-list',
			'icon-list-item',
			'timeline',
			'timeline-item',
			'icon-box',
			'stat',
			'stamp',
			'theme-toggle',
		);

		foreach ( $blocks as $slug ) {
			$dir = BLOCKWRIGHT_BLOCKS_DIR . 'build/' . $slug;
			if ( ! file_exists( $dir . '/block.json' ) ) {
				continue; // Not built yet - run `npm run build`.
			}
			register_block_type( $dir );

			if ( function_exists( 'wp_set_script_translations' ) ) {
				$handle = generate_block_asset_handle( 'blockwright/' . $slug, 'editorScript' );
				wp_set_script_translations( $handle, 'blockwright-blocks' );
			}
		}
	}
);
