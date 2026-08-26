<?php
/**
 * Adaptive Dark-mode Logo
 *
 * Lets a site show a different logo in dark mode WITHOUT SVG uploads: the core
 * Site Logo block is extended (in the Site Editor) with an optional "Dark mode
 * logo" image (assets/js/editor-site-logo-dark.js), and the front end swaps to
 * it via a <picture> with `(prefers-color-scheme: dark)`. Both images are
 * ordinary uploads (PNG). Graceful fallback: with the plugin inactive the Site
 * Logo just renders its main image in both modes, and the stored darkLogoUrl
 * attribute is harmlessly ignored.
 *
 * WHY THIS LIVES IN THE PLUGIN, NOT THE THEME: a dark-logo swap is functionality
 * a user loses on theme switch, which WordPress classifies as plugin territory
 * (Theme Review enforces presentation-vs-functionality). Extending a core
 * block's Inspector is allowed anywhere, but the persisted behaviour is not
 * theme-appropriate.
 *
 * @package Blockwright_Blocks
 * @license GPL-2.0-or-later
 */

namespace Blockwright_Blocks\AdaptiveLogo;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enqueue the editor script that adds the "Dark mode logo" control.
 */
add_action(
	'enqueue_block_editor_assets',
	function () {
		$rel  = 'assets/js/editor-site-logo-dark.js';
		$path = plugin_dir_path( __DIR__ ) . $rel;

		if ( ! file_exists( $path ) ) {
			return;
		}

		wp_enqueue_script(
			'blockwright-site-logo-dark',
			plugins_url( $rel, __DIR__ ),
			array( 'wp-blocks', 'wp-element', 'wp-hooks', 'wp-i18n', 'wp-block-editor', 'wp-components', 'wp-compose' ),
			(string) filemtime( $path ),
			true
		);

		if ( function_exists( 'wp_set_script_translations' ) ) {
			wp_set_script_translations( 'blockwright-site-logo-dark', 'blockwright-blocks' );
		}
	}
);

/**
 * Wrap the Site Logo in a <picture> that swaps to the dark logo in dark mode.
 *
 * The core render puts the <img> inside an optional home link; wrapping only
 * the <img> in <picture> leaves that link intact (verified against
 * wp-includes/blocks/site-logo.php).
 *
 * @param string $block_content Rendered block HTML.
 * @param array  $block         Parsed block, including 'attrs'.
 * @return string Filtered HTML.
 */
add_filter(
	'render_block_core/site-logo',
	function ( $block_content, $block ) {
		if ( empty( $block['attrs']['darkLogoUrl'] ) ) {
			return $block_content;
		}
		if ( false === strpos( $block_content, '<img' ) || false !== strpos( $block_content, '<picture' ) ) {
			return $block_content;
		}

		$dark_id  = isset( $block['attrs']['darkLogoId'] ) ? (int) $block['attrs']['darkLogoId'] : 0;
		$dark_url = (string) $block['attrs']['darkLogoUrl'];
		$srcset   = $dark_id ? wp_get_attachment_image_srcset( $dark_id, 'full' ) : '';
		$sizes    = $dark_id ? wp_get_attachment_image_sizes( $dark_id, 'full' ) : '';

		// srcset from WP is a multi-URL descriptor list (esc_attr, as core does for
		// srcset); the single-URL fallback is a bare URL, so escape it with esc_url.
		$srcset_attr = $srcset ? esc_attr( $srcset ) : esc_url( $dark_url );

		$source = sprintf(
			'<source media="(prefers-color-scheme: dark)" srcset="%s"%s />',
			$srcset_attr,
			$sizes ? sprintf( ' sizes="%s"', esc_attr( $sizes ) ) : ''
		);

		// Wrap the first <img> in <picture> via a callback so the replacement string
		// (which carries URL data) is never parsed for $-backreferences.
		return preg_replace_callback(
			'/<img\b[^>]*>/',
			static function ( $m ) use ( $source ) {
				return '<picture>' . $source . $m[0] . '</picture>';
			},
			$block_content,
			1
		);
	},
	10,
	2
);
