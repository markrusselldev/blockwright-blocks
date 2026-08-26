<?php
/**
 * No-flash colour-scheme preference.
 *
 * The Light / Dark Toggle block (blocks/theme-toggle/) stores a visitor's session choice in
 * sessionStorage and overrides `color-scheme` (plus `data-bw-scheme`) on <html>, which the
 * theme's light-dark() tokens and the button's action icon follow. That runs in a footer
 * viewScript - too late to avoid a flash of the OS scheme on load. This prints a tiny inline
 * script in the document head (before paint) that applies a stored light/dark choice
 * immediately. It no-ops for visitors who have not chosen this session (sessionStorage empty),
 * so it is harmless on sites without the toggle.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\ColorScheme;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'wp_head',
	function () {
		$js = "(function(){try{var m=sessionStorage.getItem('bw-color-scheme');"
			. "if(m==='light'||m==='dark'){var r=document.documentElement;r.style.colorScheme=m;"
			. "r.setAttribute('data-bw-scheme',m);}}catch(e){}})();";
		if ( function_exists( 'wp_print_inline_script_tag' ) ) {
			wp_print_inline_script_tag( $js );
		} else {
			echo '<script>' . $js . '</script>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	},
	0
);
