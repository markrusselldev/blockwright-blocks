<?php
/**
 * Design-system control plane: the supplier.
 *
 * Hands the applied design (the option the write engine keeps) to WordPress as part of the
 * THEME layer, on every request that resolves theme data, through core's
 * wp_theme_json_data_theme filter (since WP 6.1). Nothing is written to the theme's files,
 * so a theme update cannot wipe the look, and the user's Site-Editor layer stays on top of it.
 *
 * Values are swapped in BY SLUG: a preset the theme ships that the applied design does not
 * carry keeps the theme's own value, so tokens a theme update adds or fixes still arrive.
 * No color math runs here; the values were generated once, at Apply.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'wp_theme_json_data_theme', __NAMESPACE__ . '\\supply_applied_design' );

// Plugin 1.3.x kept an applied scheme in the theme's own theme.json; move it into the option once.
add_action( 'init', array( Write_Engine::class, 'migrate_legacy' ) );

/**
 * Overlay the applied design onto the theme layer.
 *
 * @param \WP_Theme_JSON_Data $theme_json The theme's data.
 * @return \WP_Theme_JSON_Data
 */
function supply_applied_design( $theme_json ) {
	$applied = Write_Engine::applied();
	if ( empty( $applied ) || ! is_object( $theme_json ) || ! method_exists( $theme_json, 'get_data' ) ) {
		return $theme_json;
	}
	$data  = $theme_json->get_data();
	$patch = array();
	foreach ( $applied as $category => $entry ) {
		$reg = get_category( $category );
		if ( null === $reg || empty( $reg['path'] ) || empty( $entry['values'] ) ) {
			continue;
		}
		$merged = overlay_presets( $data, $reg['path'], (array) $entry['values'] );
		if ( null !== $merged ) {
			$patch = Write_Engine::set_in( $patch, $reg['path'], $merged );
		}
	}
	if ( empty( $patch ) ) {
		return $theme_json;
	}
	$patch['version'] = \WP_Theme_JSON::LATEST_SCHEMA;
	return $theme_json->update_with( $patch );
}

/**
 * The theme's preset list at $path with the applied entries swapped in by slug, or null when
 * the theme data is not the shape this expects. Then the theme's own values stand: guessing
 * wrong here would blank the whole palette.
 *
 * @param array $data   Parsed theme data (presets keyed by origin, e.g. palette.theme).
 * @param array $path   Registry path, e.g. [ 'settings', 'color', 'palette' ].
 * @param array $values Applied entries: { slug, name, color }.
 * @return array|null
 */
function overlay_presets( $data, $path, $values ) {
	$node    = Write_Engine::get_in( $data, $path );
	$shipped = ( is_array( $node ) && isset( $node['theme'] ) ) ? $node['theme'] : null;
	if ( ! is_array( $shipped ) || empty( $shipped ) ) {
		return null;
	}
	$ours = array();
	foreach ( $values as $e ) {
		if ( is_array( $e ) && isset( $e['slug'], $e['color'] ) ) {
			$ours[ $e['slug'] ] = (string) $e['color'];
		}
	}
	$out = array();
	foreach ( $shipped as $e ) {
		if ( ! is_array( $e ) || ! isset( $e['slug'] ) ) {
			return null;
		}
		if ( isset( $ours[ $e['slug'] ] ) ) {
			$e['color'] = $ours[ $e['slug'] ];
		}
		$out[] = $e;
	}
	return $out;
}
