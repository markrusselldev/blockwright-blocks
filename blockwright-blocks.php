<?php
/**
 * Plugin Name:       Blockwright Blocks
 * Description:       Dynamic content bindings for any block, plus adaptive blocks that take on your theme's colours and light/dark: Icon Box, Icon List, Stat Counter, Timeline, a Light/Dark Toggle, a Stamp badge, and a curated icon collection. Degrades gracefully on any theme.
 * Version:           1.2.0
 * Requires at least: 7.0
 * Requires PHP:      7.4
 * Author:            Mark Russell
 * Author URI:        https://markrussell.io
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       blockwright-blocks
 *
 * @package Blockwright_Blocks
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'BLOCKWRIGHT_BLOCKS_VERSION' ) ) {
	define( 'BLOCKWRIGHT_BLOCKS_VERSION', '1.2.0' );
}
if ( ! defined( 'BLOCKWRIGHT_BLOCKS_DIR' ) ) {
	define( 'BLOCKWRIGHT_BLOCKS_DIR', plugin_dir_path( __FILE__ ) );
}
if ( ! defined( 'BLOCKWRIGHT_BLOCKS_URL' ) ) {
	define( 'BLOCKWRIGHT_BLOCKS_URL', plugin_dir_url( __FILE__ ) );
}

// Feature modules. Each is self-contained and degrades gracefully if the active
// theme does not provide Blockwright's tokens (see the per-file headers).
// The developer workbench moved to its own plugin, blockwright-workbench, 2026-08-05.
require_once BLOCKWRIGHT_BLOCKS_DIR . 'inc/blocks.php';
require_once BLOCKWRIGHT_BLOCKS_DIR . 'inc/adaptive-logo.php';
require_once BLOCKWRIGHT_BLOCKS_DIR . 'inc/bindings.php';
require_once BLOCKWRIGHT_BLOCKS_DIR . 'inc/icons.php';
require_once BLOCKWRIGHT_BLOCKS_DIR . 'inc/color-scheme.php';
