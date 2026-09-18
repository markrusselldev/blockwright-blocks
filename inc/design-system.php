<?php
/**
 * Design-system control plane: the shared registry.
 *
 * The registry is one declarative map of the design source of truth: each category
 * (color first; typography, spacing and more later) and, per category, WHERE it lives
 * in theme.json plus HOW it is written. The write engine and the admin UI both read
 * this, so an ability never hardcodes a theme.json path - it asks the registry. The
 * map is stored as JSON (lib/design-system/registry.json) so PHP (the write engine)
 * and JS (the admin) read one identical source and cannot drift.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Load and return the design-system registry (memoized).
 *
 * @return array The decoded registry, or an empty shape if the file is missing.
 */
function registry() {
	static $registry = null;
	if ( null !== $registry ) {
		return $registry;
	}
	$file     = BLOCKWRIGHT_BLOCKS_DIR . 'lib/design-system/registry.json';
	$data     = is_readable( $file )
		? wp_json_file_decode( $file, array( 'associative' => true ) )
		: null;
	$registry = is_array( $data ) ? $data : array(
		'version'    => 1,
		'categories' => array(),
	);
	return $registry;
}

/**
 * Return one category's registry entry, or null if the category is unknown.
 *
 * @param string $category Category key, e.g. 'color'.
 * @return array|null The category entry, or null.
 */
function get_category( $category ) {
	$categories = registry()['categories'] ?? array();
	return isset( $categories[ $category ] ) ? $categories[ $category ] : null;
}
