<?php
/**
 * Design-system control plane: the admin screen.
 *
 * Registers an Appearance -> Design page hosting the design tool (color first). The
 * React app renders into #bw-design-system-root; this file only registers the menu,
 * enqueues the built bundle on that one screen, and hands the app the active theme's
 * current palette to generate from.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PAGE_SLUG    = 'blockwright-design';
const REQUIRED_CAP = 'edit_theme_options';

/**
 * Register the Appearance -> Design page.
 */
add_action(
	'admin_menu',
	static function () {
		$hook = add_submenu_page(
			'themes.php',
			__( 'Design', 'blockwright-blocks' ),
			__( 'Design', 'blockwright-blocks' ),
			REQUIRED_CAP,
			PAGE_SLUG,
			__NAMESPACE__ . '\\render_page'
		);
		if ( $hook ) {
			add_action( 'load-' . $hook, __NAMESPACE__ . '\\mark_screen' );
		}
	}
);

/**
 * Flag that we are on our screen, so the enqueue only runs here.
 */
function mark_screen() {
	add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue' );
}

/**
 * Enqueue the built admin bundle and hand it the current theme palette.
 */
function enqueue() {
	$asset_file = BLOCKWRIGHT_BLOCKS_DIR . 'build/design-system/index.asset.php';
	if ( ! is_readable( $asset_file ) ) {
		return;
	}
	$asset = require $asset_file;

	wp_enqueue_script(
		'bw-design-system',
		BLOCKWRIGHT_BLOCKS_URL . 'build/design-system/index.js',
		$asset['dependencies'],
		$asset['version'],
		true
	);
	wp_enqueue_style( 'wp-components' );

	$style_file = BLOCKWRIGHT_BLOCKS_DIR . 'build/design-system/style-index.css';
	if ( is_readable( $style_file ) ) {
		wp_enqueue_style(
			'bw-design-system',
			BLOCKWRIGHT_BLOCKS_URL . 'build/design-system/style-index.css',
			array( 'wp-components' ),
			$asset['version']
		);
	}

	wp_add_inline_script(
		'bw-design-system',
		'window.bwDesignSystem = ' . wp_json_encode(
			array(
				'basePalette' => current_theme_palette(),
				'presets'     => theme_color_presets(),
				'siteUrl'     => home_url( '/' ),
			),
			// Escape </script> and & for safe embedding in an inline <script> block.
			JSON_HEX_TAG | JSON_HEX_AMP
		) . ';',
		'before'
	);
}

/**
 * The theme's shipped color style variations, as one-click presets: each is a full
 * palette (WordPress replaces the palette wholesale, so a color variation already
 * carries every token). Type-only variations (no palette) are skipped.
 *
 * @return array[] Each: { title, slug, palette: [ { slug, name, color } ] }.
 */
function theme_color_presets() {
	if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
		return array();
	}
	$variations = \WP_Theme_JSON_Resolver::get_style_variations( 'theme' );
	$out        = array();
	foreach ( (array) $variations as $variation ) {
		$palette = isset( $variation['settings']['color']['palette'] )
			? $variation['settings']['color']['palette']
			: array();
		// get_style_variations() returns the palette keyed by origin, e.g.
		// [ 'theme' => [ ...entries ] ]. Unwrap to the flat entry list.
		if ( isset( $palette['theme'] ) ) {
			$palette = $palette['theme'];
		}
		if ( empty( $palette ) ) {
			continue;
		}
		$title = isset( $variation['title'] ) ? $variation['title'] : '';
		$clean = array();
		foreach ( $palette as $entry ) {
			if ( ! isset( $entry['slug'], $entry['color'] ) ) {
				continue;
			}
			$clean[] = array(
				'slug'  => $entry['slug'],
				'name'  => isset( $entry['name'] ) ? $entry['name'] : $entry['slug'],
				'color' => $entry['color'],
			);
		}
		$out[] = array(
			'title'   => $title,
			'slug'    => sanitize_title( $title ),
			'palette' => $clean,
		);
	}
	return $out;
}

/**
 * The active theme's palette (theme origin), as { slug, name, color } entries - the
 * foundation the color recipe generates from.
 *
 * @return array[]
 */
function current_theme_palette() {
	if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
		return array();
	}
	$settings = \WP_Theme_JSON_Resolver::get_theme_data()->get_settings();
	$palette  = isset( $settings['color']['palette']['theme'] )
		? $settings['color']['palette']['theme']
		: array();
	$out      = array();
	foreach ( $palette as $entry ) {
		if ( ! isset( $entry['slug'], $entry['color'] ) ) {
			continue;
		}
		$out[] = array(
			'slug'  => $entry['slug'],
			'name'  => isset( $entry['name'] ) ? $entry['name'] : $entry['slug'],
			'color' => $entry['color'],
		);
	}
	return $out;
}

/**
 * Render the page shell. The React app mounts into the root node.
 */
function render_page() {
	echo '<div class="wrap">';
	// Brand carried as the page title itself (a normal h1, like "WooCommerce Settings") - it
	// attributes the screen to the plugin family with no extra height and no bespoke widget.
	echo '<h1>' . esc_html__( 'Blockwright Design', 'blockwright-blocks' ) . '</h1>';
	echo '<p class="bw-ds-intro">' . esc_html__( 'Control your design system at the source.', 'blockwright-blocks' ) . '<br>' . esc_html__( 'Each module writes your theme\'s tokens directly, drift-free. Nothing is saved until you apply it.', 'blockwright-blocks' ) . '</p>';
	echo '<div id="bw-design-system-root"></div>';
	echo '</div>';
}
