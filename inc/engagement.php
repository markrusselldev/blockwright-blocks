<?php
/**
 * Companion-theme notice and review links.
 *
 * Kept quiet on purpose, per the plugin directory's rule that notices be limited in scope,
 * used sparingly and dismissible:
 *
 * - Companion notice: on the Plugins screen only, only while the site is not using the
 *   Blockwright theme, until the user dismisses it (remembered per user) or Blockwright is
 *   activated. The link opens WordPress's own theme installer.
 * - Reviews: a "Rate it" link in the plugin's row, a one-line footer on the Design screen, and
 *   (sent to the Design screen) whether its success message may carry a review link. That link is
 *   offered only after a completed Apply at least a week after install, no more than three times
 *   a year and a month apart, and never again once followed.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\Engagement;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const INSTALLED_OPTION  = 'blockwright_blocks_installed';
const DISMISS_META      = 'blockwright_blocks_companion_dismissed';
const REVIEW_META       = 'blockwright_blocks_review';
const REVIEW_URL        = 'https://wordpress.org/support/plugin/blockwright-blocks/reviews/#new-post';
const REVIEW_MIN_AGE    = WEEK_IN_SECONDS;
const REVIEW_MIN_GAP    = MONTH_IN_SECONDS;
const REVIEW_MAX_A_YEAR = 3;

/**
 * Whether the active theme is Blockwright or a child of it.
 *
 * @return bool
 */
function theme_is_blockwright() {
	return 'blockwright' === wp_get_theme( get_template() )->get( 'TextDomain' );
}

// When the plugin was first seen, for the review timing. Set lazily (not only on activation),
// so sites that update from an earlier version get a start date too.
add_action(
	'admin_init',
	static function () {
		if ( false === get_option( INSTALLED_OPTION, false ) ) {
			add_option( INSTALLED_OPTION, time(), '', false );
		}
	}
);

// Companion-theme notice, Plugins screen only.
add_action(
	'admin_notices',
	static function () {
		$screen = get_current_screen();
		if ( ! $screen || 'plugins' !== $screen->id || theme_is_blockwright() ) {
			return;
		}
		if ( ! current_user_can( 'install_themes' ) && ! current_user_can( 'switch_themes' ) ) {
			return;
		}
		if ( get_user_meta( get_current_user_id(), DISMISS_META, true ) ) {
			return;
		}
		$installed = wp_get_theme( 'blockwright' )->exists();
		$url       = $installed
			? admin_url( 'themes.php?theme=blockwright' )
			: admin_url( 'theme-install.php?theme=blockwright' );
		$message   = sprintf(
			'%1$s <a href="%2$s">%3$s</a>',
			esc_html__( 'Blockwright Blocks is built to pair with the free Blockwright theme: its Design tool is made for it, and the blocks pick up its colors and light and dark modes.', 'blockwright-blocks' ),
			esc_url( $url ),
			$installed ? esc_html__( 'Activate the Blockwright theme', 'blockwright-blocks' ) : esc_html__( 'Get the Blockwright theme', 'blockwright-blocks' )
		);
		wp_admin_notice(
			$message,
			array(
				'type'               => 'info',
				'dismissible'        => true,
				'id'                 => 'bw-companion-notice',
				'additional_classes' => array( 'bw-companion-notice' ),
			)
		);
		// WordPress's dismiss button only hides the notice for this page view; record the dismissal.
		$nonce = wp_create_nonce( 'bw_dismiss_companion' );
		wp_print_inline_script_tag(
			"document.addEventListener('click',function(e){var b=e.target.closest('#bw-companion-notice .notice-dismiss');if(!b){return;}"
			. "var d=new FormData();d.append('action','bw_dismiss_companion');d.append('_ajax_nonce'," . wp_json_encode( $nonce ) . ');'
			. 'fetch(' . wp_json_encode( admin_url( 'admin-ajax.php' ) ) . ",{method:'POST',credentials:'same-origin',body:d});});"
		);
	}
);

add_action(
	'wp_ajax_bw_dismiss_companion',
	static function () {
		check_ajax_referer( 'bw_dismiss_companion' );
		update_user_meta( get_current_user_id(), DISMISS_META, time() );
		wp_send_json_success();
	}
);

// "Rate it" in the plugin's row on the Plugins screen.
add_filter(
	'plugin_row_meta',
	static function ( $meta, $file ) {
		if ( plugin_basename( BLOCKWRIGHT_BLOCKS_DIR . 'blockwright-blocks.php' ) === $file ) {
			$meta[] = sprintf(
				'<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
				esc_url( REVIEW_URL ),
				esc_html__( 'Rate it', 'blockwright-blocks' )
			);
		}
		return $meta;
	},
	10,
	2
);

// A one-line footer on the Design screen, in place of WordPress's own footer thank-you.
add_filter(
	'admin_footer_text',
	static function ( $text ) {
		$screen = get_current_screen();
		if ( ! $screen || 'appearance_page_blockwright-design' !== $screen->id ) {
			return $text;
		}
		return sprintf(
			'%1$s <a href="%2$s" target="_blank" rel="noopener noreferrer">%3$s</a>',
			esc_html__( 'If Blockwright Blocks helps your work, a review helps others find it:', 'blockwright-blocks' ),
			esc_url( REVIEW_URL ),
			esc_html__( 'review it on WordPress.org', 'blockwright-blocks' )
		);
	}
);

/**
 * Whether the Design screen's success message may carry a review link for the current user.
 *
 * @return bool
 */
function review_link_allowed() {
	$installed = (int) get_option( INSTALLED_OPTION, 0 );
	if ( ! $installed || time() - $installed < REVIEW_MIN_AGE ) {
		return false;
	}
	$state = get_user_meta( get_current_user_id(), REVIEW_META, true );
	$state = is_array( $state ) ? $state : array();
	if ( ! empty( $state['done'] ) ) {
		return false;
	}
	$asks = array_filter(
		(array) ( $state['asked'] ?? array() ),
		static function ( $t ) {
			return (int) $t > time() - YEAR_IN_SECONDS;
		}
	);
	if ( count( $asks ) >= REVIEW_MAX_A_YEAR ) {
		return false;
	}
	return empty( $asks ) || time() - max( $asks ) >= REVIEW_MIN_GAP;
}

/**
 * Record that the review link was shown, or followed.
 *
 * @param string $event 'shown' or 'clicked'.
 */
function record_review_event( $event ) {
	$user  = get_current_user_id();
	$state = get_user_meta( $user, REVIEW_META, true );
	$state = is_array( $state ) ? $state : array();
	if ( 'clicked' === $event ) {
		$state['done'] = true;
	} else {
		$state['asked']   = array_values( (array) ( $state['asked'] ?? array() ) );
		$state['asked'][] = time();
	}
	update_user_meta( $user, REVIEW_META, $state );
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'blockwright/v1',
			'/review',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'edit_theme_options' );
				},
				'callback'            => static function ( $request ) {
					record_review_event( 'clicked' === $request['event'] ? 'clicked' : 'shown' );
					return new \WP_REST_Response( array( 'ok' => true ), 200 );
				},
				'args'                => array(
					'event' => array(
						'type'     => 'string',
						'enum'     => array( 'shown', 'clicked' ),
						'required' => true,
					),
				),
			)
		);
	}
);
