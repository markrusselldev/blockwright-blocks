<?php
/**
 * Design-system control plane: REST endpoints.
 *
 * The admin screen talks to these to save a scheme, list restore points, and roll
 * back. Every route requires the same capability WordPress requires to edit the Site
 * Editor (edit_theme_options) and the standard REST nonce. The apply route is the only
 * one that writes, and it runs each incoming color value through a strict allowlist
 * (colors only - nothing that could carry a ";" or "}" and break out of a CSS
 * declaration) before handing the palette to the write engine.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem\Rest;

use Blockwright_Blocks\DesignSystem\Write_Engine;
use function Blockwright_Blocks\DesignSystem\get_category;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const NAMESPACE_V1 = 'blockwright/v1';
const REQUIRED_CAP = 'edit_theme_options';

/**
 * Permission callback shared by every route.
 *
 * @return bool
 */
function can_manage() {
	return current_user_can( REQUIRED_CAP );
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			NAMESPACE_V1,
			'/design/apply',
			array(
				'methods'             => 'POST',
				'permission_callback' => __NAMESPACE__ . '\\can_manage',
				'callback'            => __NAMESPACE__ . '\\apply',
				'args'                => array(
					'category' => array(
						'type'     => 'string',
						'required' => true,
					),
					'palette'  => array(
						'type'     => 'array',
						'required' => true,
					),
					'label'    => array(
						'type'     => 'string',
						'required' => false,
					),
				),
			)
		);
		register_rest_route(
			NAMESPACE_V1,
			'/design/snapshots',
			array(
				'methods'             => 'GET',
				'permission_callback' => __NAMESPACE__ . '\\can_manage',
				'callback'            => __NAMESPACE__ . '\\list_snapshots',
			)
		);
		register_rest_route(
			NAMESPACE_V1,
			'/design/snapshots/(?P<id>[A-Za-z0-9._\-]+)',
			array(
				'methods'             => 'DELETE',
				'permission_callback' => __NAMESPACE__ . '\\can_manage',
				'callback'            => __NAMESPACE__ . '\\delete_snapshot',
				'args'                => array(
					'id' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			NAMESPACE_V1,
			'/design/restore',
			array(
				'methods'             => 'POST',
				'permission_callback' => __NAMESPACE__ . '\\can_manage',
				'callback'            => __NAMESPACE__ . '\\restore',
				'args'                => array(
					'id' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}
);

/**
 * Apply a generated scheme: validate the palette, then write it through the engine.
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response|\WP_Error
 */
function apply( $request ) {
	$category = (string) $request['category'];
	$entry    = get_category( $category );
	if ( null === $entry ) {
		return new \WP_Error( 'bw_unknown_category', __( 'Unknown design category.', 'blockwright-blocks' ), array( 'status' => 400 ) );
	}

	$clean = sanitize_palette( (array) $request['palette'] );
	if ( is_wp_error( $clean ) ) {
		return $clean;
	}

	$label  = isset( $request['label'] ) ? sanitize_text_field( (string) $request['label'] ) : '';
	$result = Write_Engine::write( $category, $clean, $label );
	if ( is_wp_error( $result ) ) {
		// Each engine error carries its own HTTP status at the source (e.g. an unwritable
		// theme.json is a 409 client-environment condition, a locked write 409, a missing
		// snapshot 404), so pass it through rather than guessing here.
		return $result;
	}
	return new \WP_REST_Response(
		array(
			'ok'       => true,
			'snapshot' => $result['snapshot'],
		),
		200
	);
}

/**
 * List restore points.
 *
 * @return \WP_REST_Response
 */
function list_snapshots() {
	return new \WP_REST_Response( Write_Engine::list_snapshots(), 200 );
}

/**
 * Delete a restore point.
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response|\WP_Error
 */
function delete_snapshot( $request ) {
	$result = Write_Engine::delete_snapshot( (string) $request['id'] );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return new \WP_REST_Response( array( 'ok' => true ), 200 );
}

/**
 * Restore a snapshot.
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response|\WP_Error
 */
function restore( $request ) {
	$result = Write_Engine::restore( (string) $request['id'] );
	if ( is_wp_error( $result ) ) {
		// Status set at the source (404 missing, 422 unreadable, 409 not-writable/locked).
		return $result;
	}
	return new \WP_REST_Response( array( 'ok' => true ), 200 );
}

/**
 * Validate + clean an incoming palette. Each entry must be { slug, name, color } where
 * the slug already exists in the active theme palette, the name is plain text, and the
 * color matches the allowlist of CSS color forms our recipe produces. Rejects the whole
 * payload (never writes a partial palette) on any bad entry.
 *
 * @param array $palette Raw entries from the request.
 * @return array|\WP_Error Clean entries, or an error.
 */
function sanitize_palette( $palette ) {
	if ( empty( $palette ) ) {
		return new \WP_Error( 'bw_empty_palette', __( 'No palette to apply.', 'blockwright-blocks' ), array( 'status' => 400 ) );
	}
	$clean = array();
	foreach ( $palette as $entry ) {
		if ( ! is_array( $entry ) || ! isset( $entry['slug'], $entry['color'] ) ) {
			return new \WP_Error( 'bw_bad_entry', __( 'A palette entry is malformed.', 'blockwright-blocks' ), array( 'status' => 400 ) );
		}
		// The slug is a preset-var name only (sanitize_key keeps it to safe chars); we do
		// NOT reject "unknown" slugs, because applying a scheme replaces the whole palette,
		// so a token valid in one scheme can be absent from the current theme after another
		// was applied. Security lives in the color-value allowlist below, not the slug set.
		$slug = sanitize_key( $entry['slug'] );
		if ( ! is_allowed_color( (string) $entry['color'] ) ) {
			return new \WP_Error(
				'bw_bad_color',
				/* translators: %s: color token slug. */
				sprintf( __( 'A color value is not allowed (token %s).', 'blockwright-blocks' ), $slug ),
				array( 'status' => 400 )
			);
		}
		$clean[] = array(
			'slug'  => $slug,
			'name'  => isset( $entry['name'] ) ? sanitize_text_field( (string) $entry['name'] ) : $slug,
			'color' => trim( (string) $entry['color'] ),
		);
	}
	return $clean;
}


/**
 * Whether a string is one of the CSS color forms the recipe produces. The security
 * property that matters: the value can contain no ";", "{", "}", "<", ">", backslash or
 * newline, so it can never escape the "--token: VALUE;" declaration it lands in. The
 * grammar check on top of that keeps values to sensible colors.
 *
 * @param string $v Candidate value.
 * @return bool
 */
function is_allowed_color( $v ) {
	if ( ! is_string( $v ) ) {
		return false;
	}
	$v = trim( $v );
	if ( '' === $v || strlen( $v ) > 200 ) {
		return false;
	}
	if ( preg_match( '/[;{}<>\\\\\r\n]/', $v ) ) {
		return false;
	}
	if ( preg_match( '/^#[0-9a-fA-F]{3,8}$/', $v ) ) {
		return true;
	}
	if ( preg_match( '/^(transparent|currentColor|white|black)$/i', $v ) ) {
		return true;
	}
	if ( preg_match( '/^var:preset\|color\|[a-z0-9-]+$/', $v ) ) {
		return true;
	}
	if ( preg_match( '/^var\(\s*--[a-z0-9-]+\s*(?:,\s*[a-zA-Z0-9#%.\s-]+)?\)$/', $v ) ) {
		return true;
	}
	if ( preg_match( '/^(oklch|oklab|lab|lch|rgb|rgba|hsl|hsla)\(\s*[0-9%.\/,\s-]+\)$/i', $v ) ) {
		return true;
	}
	if ( preg_match( '/^light-dark\(\s*(.+?)\s*,\s*(.+)\)$/is', $v, $m ) ) {
		return is_allowed_color( $m[1] ) && is_allowed_color( $m[2] );
	}
	if ( preg_match( '/^color-mix\(\s*in\s+[a-z0-9 -]+,\s*(.+)\)$/is', $v, $m ) ) {
		$parts = explode( ',', $m[1] );
		if ( count( $parts ) !== 2 ) {
			return false;
		}
		foreach ( $parts as $part ) {
			$part = trim( preg_replace( '/\s+[0-9.]+%$/', '', trim( $part ) ) );
			if ( ! is_allowed_color( $part ) ) {
				return false;
			}
		}
		return true;
	}
	return false;
}
