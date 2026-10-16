<?php
/**
 * Design-system control plane: the write engine - the one and only door that changes
 * the applied design.
 *
 * The applied look lives in ONE option, keyed by theme and module, and is
 * handed to WordPress on every request by the supplier (design-supply.php) through core's
 * wp_theme_json_data_theme filter. Nothing here writes the theme's files: a theme update
 * deletes and replaces the theme directory, so anything stored there is lost. An Apply does
 * not write values into the user's Global Styles record either; that layer is the site
 * owner's, and values copied into it never receive later theme updates. The one exception
 * is "Copy to site styles", which the owner chooses explicitly (keep_in_site_styles()).
 *
 * Order of the layers WordPress merges design data: core < blocks < theme < the user's
 * Site-Editor record (a wp_global_styles post). The supplier puts our values into the theme
 * layer; an Apply then clears the same key from the user record, so a Site-Editor override
 * of that slice does not hide the scheme just applied. Every write snapshots, so any change
 * is reversible.
 *
 * The category being written (which path in theme.json it owns) comes from the registry, so
 * this engine is not color-specific: every ability writes through it.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The write engine. Static methods; the state it manages is the applied-design option and
 * the restore-point files.
 */
class Write_Engine {

	/**
	 * Newest auto restore points to keep on disk PER MODULE (color, typography, ...); older
	 * ones of the SAME module are pruned after each new snapshot, so one module's churn never
	 * evicts another's restore points. The pristine "original" baseline is never counted or
	 * pruned. 50 is generous on purpose - a snapshot is a few KB, and pruning is permanent
	 * (no recycle bin), so the cap exists to bound growth, not to save space.
	 */
	const MAX_AUTO_SNAPSHOTS_PER_MODULE = 50;

	/**
	 * The option holding the applied design: { stylesheet: { category: entry } }, where an
	 * entry is { values, inputs, label, time }. Autoloaded, because the supplier reads it on
	 * every request that resolves theme data.
	 */
	const OPTION = 'blockwright_blocks_design';

	/**
	 * Apply a category's values: store them in the option for the active theme, clear the
	 * matching key from the user Global Styles record, and save a restore point.
	 *
	 * @param string     $category Registry category key, e.g. 'color'.
	 * @param array      $values   The values to apply (for color: palette entries).
	 * @param string     $label    Optional human label for the restore point.
	 * @param array|null $inputs   The inputs that produced the values (preset, seed, ...), kept so
	 *                             a later engine can regenerate them; null when unknown.
	 * @param array      $opts     { driven: string[] the slugs the scheme sets - only those are
	 *                             stored, so every other token keeps following the theme;
	 *                             clear_user: bool, default true - false for an automatic refresh,
	 *                             which must not undo a look the owner copied into site styles }.
	 * @return array|\WP_Error { snapshot: string } on success, WP_Error on failure.
	 */
	public static function write( $category, $values, $label = '', $inputs = null, $opts = array() ) {
		$entry = get_category( $category );
		if ( null === $entry || empty( $entry['path'] ) ) {
			return new \WP_Error( 'bw_unknown_category', "Unknown design-system category: $category", array( 'status' => 400 ) );
		}

		// Keep a pristine "original" restore point, once, before the first change ever.
		self::capture_original();

		$values = self::only_slugs( (array) $values, isset( $opts['driven'] ) ? (array) $opts['driven'] : array() );
		if ( empty( $values ) ) {
			return new \WP_Error( 'bw_empty_palette', 'No values to apply.', array( 'status' => 400 ) );
		}

		$applied              = self::applied();
		$applied[ $category ] = array(
			'values' => $values,
			'inputs' => is_array( $inputs ) ? $inputs : null,
			'label'  => (string) $label,
			'time'   => microtime( true ),
		);
		self::save_applied( $applied );

		// A Site-Editor override of this slice would hide what was just applied. An automatic
		// refresh leaves it: the owner may have copied the look into site styles on purpose.
		if ( ! isset( $opts['clear_user'] ) || $opts['clear_user'] ) {
			self::clear_user_override( $entry['path'] );
		}
		self::after_change();

		// Snapshot the APPLIED state, labeled "<Module>: <what changed>" so a restore point reads
		// as a full checkpoint of the whole applied design taken when that module changed - the
		// module prefix is added here so every ability gets it for free. Restoring this point
		// returns to THIS look, not the state before it (the pristine baseline is the theme's original).
		$change   = '' !== (string) $label ? $label : __( 'applied', 'blockwright-blocks' );
		$display  = self::category_label( $category ) . ': ' . $change;
		$snapshot = self::snapshot( $display, $category );
		if ( is_wp_error( $snapshot ) ) {
			return $snapshot;
		}

		return array( 'snapshot' => basename( $snapshot ) );
	}

	/**
	 * The applied design for the active theme: { category: entry }.
	 *
	 * @return array
	 */
	public static function applied() {
		$all = get_option( self::OPTION, array() );
		$key = get_stylesheet();
		return ( is_array( $all ) && isset( $all[ $key ] ) && is_array( $all[ $key ] ) ) ? $all[ $key ] : array();
	}

	/**
	 * Keep only the entries whose slug is in $slugs (all of them when $slugs is empty).
	 *
	 * @param array    $values Entries with a slug.
	 * @param string[] $slugs  Slugs to keep.
	 * @return array
	 */
	public static function only_slugs( $values, $slugs ) {
		$values = array_values(
			array_filter(
				$values,
				static function ( $e ) {
					return is_array( $e ) && isset( $e['slug'] );
				}
			)
		);
		if ( empty( $slugs ) ) {
			return $values;
		}
		$keep = array_flip( array_map( 'strval', $slugs ) );
		return array_values(
			array_filter(
				$values,
				static function ( $e ) use ( $keep ) {
					return isset( $keep[ $e['slug'] ] );
				}
			)
		);
	}

	/**
	 * Store the applied design for a theme (the active one by default), leaving other themes'
	 * entries intact (so switching back to a theme brings its look back).
	 *
	 * @param array       $applied    { category: entry }; empty removes this theme's entry.
	 * @param string|null $stylesheet Theme to store it for; null = the active theme.
	 */
	private static function save_applied( $applied, $stylesheet = null ) {
		$all = get_option( self::OPTION, array() );
		$all = is_array( $all ) ? $all : array();
		$key = null === $stylesheet ? get_stylesheet() : (string) $stylesheet;
		if ( empty( $applied ) ) {
			unset( $all[ $key ] );
		} else {
			$all[ $key ] = $applied;
		}
		update_option( self::OPTION, $all, true );
	}

	/**
	 * Restore a snapshot: put back the applied design and the user Global Styles record it
	 * captured. A restore point saved by plugin 1.3.x stored the whole theme.json instead; for
	 * those, the palette inside it becomes the applied color (the pre-change "original" means
	 * nothing applied), and the theme's own file is never written.
	 *
	 * @param string $id Snapshot file name (an original baseline or an auto snapshot).
	 * @return true|\WP_Error
	 */
	public static function restore( $id ) {
		$id   = basename( (string) $id );
		$file = trailingslashit( self::snapshots_dir() ) . $id;
		if ( ! is_readable( $file ) ) {
			return new \WP_Error( 'bw_snapshot_missing', "Snapshot not found: $id", array( 'status' => 404 ) );
		}
		$snap = wp_json_file_decode( $file, array( 'associative' => true ) );
		if ( ! is_array( $snap ) ) {
			return new \WP_Error( 'bw_snapshot_invalid', "Snapshot is unreadable: $id", array( 'status' => 422 ) );
		}
		if ( isset( $snap['theme'] ) && get_stylesheet() !== $snap['theme'] ) {
			return new \WP_Error( 'bw_snapshot_other_theme', 'This restore point belongs to a different theme.', array( 'status' => 409 ) );
		}
		$applied = self::applied_from_snapshot( $snap, $id );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}
		// A legacy point carries the whole palette. Trim it to the slugs a scheme sets, as known
		// from what is applied now, so the other tokens keep following the theme.
		$current = self::applied();
		foreach ( $applied as $category => $entry ) {
			if ( null === ( $entry['inputs'] ?? null ) && ! empty( $current[ $category ]['values'] ) ) {
				$applied[ $category ]['values'] = self::only_slugs( (array) $entry['values'], wp_list_pluck( $current[ $category ]['values'], 'slug' ) );
			}
		}
		self::save_applied( $applied );
		self::restore_user_override( $snap['user_global_styles'] ?? null );
		self::after_change();
		return true;
	}

	/**
	 * The applied design a snapshot stands for.
	 *
	 * @param array  $snap Decoded snapshot.
	 * @param string $id   Snapshot file name.
	 * @return array|\WP_Error
	 */
	private static function applied_from_snapshot( $snap, $id ) {
		if ( array_key_exists( 'applied', $snap ) ) {
			return is_array( $snap['applied'] ) ? $snap['applied'] : array();
		}
		// Legacy (plugin 1.3.x) snapshot: a copy of the whole theme.json.
		if ( self::is_original( $id ) ) {
			return array();
		}
		$palette = self::legacy_palette( $snap );
		if ( null === $palette ) {
			return new \WP_Error( 'bw_snapshot_invalid', "Snapshot is unreadable: $id", array( 'status' => 422 ) );
		}
		return array(
			'color' => array(
				'values' => $palette,
				'inputs' => null,
				'label'  => self::label_change( isset( $snap['label'] ) ? (string) $snap['label'] : '' ),
				'time'   => isset( $snap['time'] ) ? (float) $snap['time'] : 0,
			),
		);
	}

	/**
	 * The palette inside a legacy snapshot's stored theme.json, or null.
	 *
	 * @param array $snap Decoded snapshot.
	 * @return array|null
	 */
	private static function legacy_palette( $snap ) {
		$raw = isset( $snap['theme_json_raw'] ) ? json_decode( (string) $snap['theme_json_raw'], true ) : ( $snap['theme_json'] ?? null );
		$pal = is_array( $raw ) ? ( $raw['settings']['color']['palette'] ?? null ) : null;
		if ( ! is_array( $pal ) || empty( $pal ) ) {
			return null;
		}
		$out = array();
		foreach ( $pal as $e ) {
			if ( is_array( $e ) && isset( $e['slug'], $e['color'] ) ) {
				$out[] = array(
					'slug'  => (string) $e['slug'],
					'name'  => isset( $e['name'] ) ? (string) $e['name'] : (string) $e['slug'],
					'color' => (string) $e['color'],
				);
			}
		}
		return $out ? $out : null;
	}

	/**
	 * The "what changed" half of a "<Module>: <what changed>" restore-point label.
	 *
	 * @param string $label Full label.
	 * @return string
	 */
	private static function label_change( $label ) {
		$pos = strpos( $label, ': ' );
		return false === $pos ? $label : substr( $label, $pos + 2 );
	}

	/**
	 * One-time move of a site that applied a scheme with plugin 1.3.x (the scheme then lived in
	 * the theme's theme.json): for EVERY theme with such a restore point, the newest one becomes
	 * that theme's applied color, so the next theme update cannot wipe it, including a theme
	 * that is not active right now. Runs once; marks itself done by creating the option. Inputs
	 * are unknown (restore points never stored them), so the Design screen re-derives them from
	 * the label and trims the values to the tokens a scheme sets.
	 */
	public static function migrate_legacy() {
		if ( false !== get_option( self::OPTION, false ) ) {
			return;
		}
		// Create the option first, so a failure below can never make this run every request.
		add_option( self::OPTION, array(), '', true );
		$dir = self::snapshots_dir();
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$newest = array();
		foreach ( (array) glob( trailingslashit( $dir ) . 'auto-*.json' ) as $file ) {
			$snap  = wp_json_file_decode( $file, array( 'associative' => true ) );
			$theme = is_array( $snap ) ? (string) ( $snap['theme'] ?? '' ) : '';
			if ( '' === $theme || array_key_exists( 'applied', $snap ) || 'color' !== self::snapshot_category( $file ) ) {
				continue;
			}
			if ( ! isset( $newest[ $theme ] ) || (float) ( $snap['time'] ?? 0 ) > (float) ( $newest[ $theme ]['time'] ?? 0 ) ) {
				$newest[ $theme ] = $snap;
			}
		}
		foreach ( $newest as $theme => $snap ) {
			$applied = self::applied_from_snapshot( $snap, 'auto' );
			if ( ! is_wp_error( $applied ) ) {
				self::save_applied( $applied, $theme );
			}
		}
	}

	/**
	 * Recompute merged design data and purge page caches after the applied design changed.
	 */
	private static function after_change() {
		if ( function_exists( 'wp_clean_theme_json_cache' ) ) {
			wp_clean_theme_json_cache();
		}
		self::purge_caches();
	}

	/**
	 * Copy the applied design into the user's Global Styles record, so the look survives this
	 * plugin being deactivated. It is the site owner's explicit choice, with a cost: values in
	 * that record override the theme wholesale, so later theme updates no longer reach them.
	 * The applied design stays stored, and a restore point is saved.
	 *
	 * @return array|\WP_Error { snapshot: string } on success, WP_Error on failure.
	 */
	public static function keep_in_site_styles() {
		$applied = self::applied();
		$post_id = self::user_global_styles_post_id();
		if ( empty( $applied ) ) {
			return new \WP_Error( 'bw_nothing_applied', 'Nothing has been applied yet.', array( 'status' => 409 ) );
		}
		if ( ! $post_id ) {
			return new \WP_Error( 'bw_no_user_styles', 'The site styles record could not be found.', array( 'status' => 500 ) );
		}
		self::capture_original();

		\WP_Theme_JSON_Resolver::clean_cached_data();
		// Raw data keeps presets keyed by origin (palette.theme); get_data() would flatten them.
		$theme = \WP_Theme_JSON_Resolver::get_theme_data()->get_raw_data();
		$data  = json_decode( (string) get_post( $post_id )->post_content, true );
		$data  = is_array( $data ) ? $data : array();
		foreach ( array_keys( $applied ) as $category ) {
			$reg  = get_category( $category );
			$path = ( null !== $reg && ! empty( $reg['path'] ) ) ? array_merge( $reg['path'], array( 'theme' ) ) : null;
			$node = $path ? self::get_in( $theme, $path ) : null;
			if ( is_array( $node ) && ! empty( $node ) ) {
				$data = self::set_in( $data, $path, $node );
			}
		}
		$data['version']                     = \WP_Theme_JSON::LATEST_SCHEMA;
		$data['isGlobalStylesUserThemeJSON'] = true;
		// wp_update_post expects slashed content; the JSON's escapes are stripped otherwise.
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( wp_json_encode( $data ) ),
			)
		);
		self::after_change();

		$snapshot = self::snapshot( self::category_label( 'color' ) . ': ' . __( 'copied to site styles', 'blockwright-blocks' ), 'color' );
		return is_wp_error( $snapshot ) ? $snapshot : array( 'snapshot' => basename( $snapshot ) );
	}

	/**
	 * Purge caches after a write, so the change shows on cached hosts. Core's theme.json
	 * cache is busted by the caller; this covers the full-page cache plugins a real host is
	 * likely to run (each is a no-op when that plugin is absent).
	 */
	private static function purge_caches() {
		wp_cache_flush();
		if ( has_action( 'litespeed_purge_all' ) ) {
			// LiteSpeed's own documented purge action; we fire it, not define it.
			do_action( 'litespeed_purge_all' ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
		}
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
		}
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache();
		}
	}

	/**
	 * List available snapshots, newest first.
	 *
	 * @return array[] Each: { id, label, time }.
	 */
	public static function list_snapshots() {
		$dir = self::snapshots_dir();
		if ( ! is_dir( $dir ) ) {
			return array();
		}
		$out = array();
		foreach ( (array) glob( trailingslashit( $dir ) . '*.json' ) as $file ) {
			$snap = wp_json_file_decode( $file, array( 'associative' => true ) );
			// Restore points belong to the theme they were taken on; restore() refuses others.
			if ( is_array( $snap ) && isset( $snap['theme'] ) && get_stylesheet() !== $snap['theme'] ) {
				continue;
			}
			$out[] = array(
				'id'       => basename( $file ),
				'label'    => is_array( $snap ) && isset( $snap['label'] ) ? $snap['label'] : '',
				'category' => is_array( $snap ) && isset( $snap['category'] ) ? (string) $snap['category'] : '',
				'original' => self::is_original( basename( $file ) ),
				'time'     => is_array( $snap ) && isset( $snap['time'] ) ? (float) $snap['time'] : 0,
			);
		}
		usort(
			$out,
			static function ( $a, $b ) {
				return $b['time'] <=> $a['time'];
			}
		);
		return $out;
	}

	/**
	 * Delete one restore point. The pristine "original" baseline is protected - deleting it
	 * would let the next apply re-capture a non-pristine state as "original", so "revert to
	 * original" would silently stop meaning the real baseline.
	 *
	 * @param string $id Snapshot file name.
	 * @return true|\WP_Error
	 */
	public static function delete_snapshot( $id ) {
		$id = basename( (string) $id );
		if ( self::is_original( $id ) ) {
			return new \WP_Error( 'bw_protect_original', 'The original baseline cannot be deleted.', array( 'status' => 400 ) );
		}
		$file = trailingslashit( self::snapshots_dir() ) . $id;
		if ( ! is_readable( $file ) ) {
			return new \WP_Error( 'bw_snapshot_missing', "Snapshot not found: $id", array( 'status' => 404 ) );
		}
		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}
		if ( ! $fs->delete( $file ) ) {
			return new \WP_Error( 'bw_delete_failed', 'Could not delete the restore point.', array( 'status' => 500 ) );
		}
		return true;
	}

	// Internals.

	/**
	 * Clear one key path from the user Global Styles record, pruning now-empty parents.
	 * Leaves everything else the user set intact.
	 *
	 * @param array $path Key path, e.g. [ 'settings', 'color', 'palette' ].
	 */
	private static function clear_user_override( $path ) {
		$post_id = self::user_global_styles_post_id();
		if ( ! $post_id ) {
			return;
		}
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}
		$data = json_decode( (string) $post->post_content, true );
		if ( ! is_array( $data ) ) {
			return;
		}
		$data = self::unset_by_path( $data, $path );
		// wp_update_post expects slashed content; without wp_slash the escaped slashes and
		// unicode in the JSON get mangled on save, corrupting the record.
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( wp_json_encode( $data ) ),
			)
		);
	}

	/**
	 * Overwrite the user Global Styles record's content (used by restore).
	 *
	 * @param string|null $content Raw post_content JSON, or null to leave it empty.
	 */
	private static function restore_user_override( $content ) {
		$post_id = self::user_global_styles_post_id();
		if ( ! $post_id ) {
			return;
		}
		$json = is_string( $content ) && '' !== $content
			? $content
			: wp_json_encode(
				array(
					'version'                     => 3,
					'isGlobalStylesUserThemeJSON' => true,
				)
			);
		// Slash before saving: wp_update_post expects slashed content, and the global-styles
		// JSON carries escaped slashes/unicode that are otherwise stripped, corrupting it.
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( $json ),
			)
		);
	}

	/**
	 * The active theme's user Global Styles post id, or 0.
	 *
	 * @return int
	 */
	private static function user_global_styles_post_id() {
		if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
			return 0;
		}
		return (int) \WP_Theme_JSON_Resolver::get_user_global_styles_post_id();
	}

	/**
	 * Take a snapshot of the applied design + user Global Styles record.
	 *
	 * @param string $label    Human label.
	 * @param string $category The module that changed (e.g. 'color'), for per-module pruning.
	 * @return string|\WP_Error Absolute snapshot file path, or error.
	 */
	private static function snapshot( $label, $category = '' ) {
		// Millisecond timestamp + a random suffix so two applies in the same second do not
		// share a filename and clobber each other's restore point.
		$name   = 'auto-' . (string) round( microtime( true ) * 1000 ) . '-' . (string) wp_rand( 100, 999 ) . '.json';
		$result = self::write_snapshot( $name, $label, $category );
		if ( ! is_wp_error( $result ) ) {
			self::prune_snapshots( $category );
		}
		return $result;
	}

	/**
	 * Keep only the newest MAX_AUTO_SNAPSHOTS_PER_MODULE auto restore points OF THE GIVEN MODULE;
	 * delete the older ones of that module. Snapshots of OTHER modules are left alone, so applying
	 * a color scheme never evicts a typography restore point. The pristine "original" baseline is
	 * never pruned. Runs after each new snapshot so restore points cannot grow without bound.
	 *
	 * @param string $category The module whose snapshots to prune (e.g. 'color'). Empty = no-op.
	 */
	private static function prune_snapshots( $category = '' ) {
		if ( '' === (string) $category ) {
			return;
		}
		// Restrict to THIS module's auto snapshots (by the stored category, with a label-prefix
		// fallback for legacy files that predate the category field).
		$files = array();
		foreach ( (array) glob( trailingslashit( self::snapshots_dir() ) . 'auto-*.json' ) as $file ) {
			if ( self::snapshot_category( $file ) === $category ) {
				$files[] = $file;
			}
		}
		if ( count( $files ) <= self::MAX_AUTO_SNAPSHOTS_PER_MODULE ) {
			return;
		}
		// Newest first by modified time.
		usort(
			$files,
			static function ( $a, $b ) {
				return filemtime( $b ) <=> filemtime( $a );
			}
		);
		$fs = self::filesystem();
		foreach ( array_slice( $files, self::MAX_AUTO_SNAPSHOTS_PER_MODULE ) as $old ) {
			if ( is_wp_error( $fs ) ) {
				return;
			}
			$fs->delete( $old );
		}
	}

	/**
	 * The module a snapshot belongs to: its stored `category`, or - for legacy files written
	 * before that field existed - the key derived from the "<Module>: ..." label prefix.
	 *
	 * @param string $file Absolute snapshot path.
	 * @return string Category key, or '' if undeterminable.
	 */
	private static function snapshot_category( $file ) {
		$snap = wp_json_file_decode( $file, array( 'associative' => true ) );
		if ( ! is_array( $snap ) ) {
			return '';
		}
		if ( ! empty( $snap['category'] ) ) {
			return (string) $snap['category'];
		}
		// Legacy fallback: map the label prefix ("Color: ...") back to a category key.
		$label  = isset( $snap['label'] ) ? (string) $snap['label'] : '';
		$prefix = trim( (string) strstr( $label, ':', true ) );
		if ( '' === $prefix ) {
			return '';
		}
		foreach ( array_keys( (array) ( registry()['categories'] ?? array() ) ) as $key ) {
			if ( 0 === strcasecmp( self::category_label( $key ), $prefix ) ) {
				return (string) $key;
			}
		}
		return '';
	}

	/**
	 * A translated display name for a design-system category, used as the restore-point label
	 * prefix. Falls back to the registry label, then the capitalized key, for categories added
	 * later without a case here.
	 *
	 * @param string $category Category key, e.g. 'color'.
	 * @return string
	 */
	private static function category_label( $category ) {
		switch ( $category ) {
			case 'color':
				return __( 'Color', 'blockwright-blocks' );
			default:
				$entry = get_category( $category );
				return ( is_array( $entry ) && ! empty( $entry['label'] ) )
					? (string) $entry['label']
					: ucfirst( (string) $category );
		}
	}

	/**
	 * Capture the active theme's pristine original once (before our first edit on it ever).
	 * Each theme gets its own, so "revert to original" means that theme's baseline. Plugin 1.3.x
	 * kept a single original.json; it still counts as the original of the theme it records.
	 */
	private static function capture_original() {
		$dir = trailingslashit( self::snapshots_dir() );
		if ( file_exists( $dir . self::original_id() ) ) {
			return;
		}
		$legacy = $dir . 'original.json';
		if ( file_exists( $legacy ) ) {
			$snap = wp_json_file_decode( $legacy, array( 'associative' => true ) );
			if ( is_array( $snap ) && get_stylesheet() === ( $snap['theme'] ?? '' ) ) {
				return;
			}
		}
		self::write_snapshot(
			self::original_id(),
			__( 'original (before first change)', 'blockwright-blocks' )
		);
	}

	/**
	 * The active theme's original-baseline file name.
	 *
	 * @return string
	 */
	private static function original_id() {
		return 'original-' . sanitize_file_name( get_stylesheet() ) . '.json';
	}

	/**
	 * Whether a snapshot file name is an original baseline (per theme, or the 1.3.x shared one).
	 *
	 * @param string $id Snapshot file name.
	 * @return bool
	 */
	private static function is_original( $id ) {
		return 'original.json' === $id || ( 0 === strpos( $id, 'original-' ) && '.json' === substr( $id, -5 ) );
	}

	/**
	 * Write a snapshot file capturing current state.
	 *
	 * @param string $name     File name.
	 * @param string $label    Human label.
	 * @param string $category The module that changed, or '' for the original baseline.
	 * @return string|\WP_Error Absolute path, or error.
	 */
	private static function write_snapshot( $name, $label, $category = '' ) {
		$dir = self::snapshots_dir();
		if ( ! wp_mkdir_p( $dir ) ) {
			return new \WP_Error( 'bw_snapshot_dir', 'Could not create the snapshots directory.', array( 'status' => 500 ) );
		}
		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}
		self::harden_dir( $fs, $dir );
		// Capture the whole applied design for this theme (every module), not a slice, so a
		// restore point is a full checkpoint, plus the user record it sat under.
		$post_id = self::user_global_styles_post_id();
		$snap    = array(
			'time'               => microtime( true ),
			'label'              => (string) $label,
			'category'           => (string) $category,
			'theme'              => get_stylesheet(),
			'applied'            => self::applied(),
			'user_global_styles' => $post_id ? (string) get_post( $post_id )->post_content : null,
		);
		$path    = trailingslashit( $dir ) . $name;
		$ok      = $fs->put_contents( $path, wp_json_encode( $snap, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ), FS_CHMOD_FILE );
		return $ok ? $path : new \WP_Error( 'bw_snapshot_failed', 'Writing the snapshot failed.', array( 'status' => 500 ) );
	}

	/**
	 * Absolute path to the snapshots directory (under uploads, so it survives theme
	 * updates and is writable).
	 *
	 * @return string
	 */
	private static function snapshots_dir() {
		$uploads = wp_upload_dir();
		return trailingslashit( $uploads['basedir'] ) . 'blockwright/snapshots';
	}

	/**
	 * Keep restore-point snapshots out of public reach. They can carry the site's
	 * global-styles content, so a web-readable, listable directory in uploads is a
	 * needless exposure. Two layers, both idempotent (written once, only if absent):
	 *
	 * - `index.php` in this dir AND its `blockwright` parent, the core "Silence is
	 *   golden" file (verified as `wp-content/plugins/index.php` in WP 7.1), which
	 *   stops directory listing on any server.
	 * - `.htaccess` denying direct file access on Apache/LiteSpeed (the common shared-host
	 *   stack), guarded for both Apache 2.4 (`Require all denied`) and 2.2 (`Deny from
	 *   all`). Inert on nginx, which ignores it - hosts there rely on the index.php and the
	 *   low sensitivity of the data (colors and the site's style settings).
	 *
	 * @param \WP_Filesystem_Base $fs  Filesystem handle.
	 * @param string              $dir Snapshots directory (already created).
	 * @return void
	 */
	private static function harden_dir( $fs, $dir ) {
		$silence  = "<?php\n// Silence is golden.\n";
		$htaccess = "# Blockwright: deny direct web access to restore-point snapshots.\n"
			. "<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n"
			. "<IfModule !mod_authz_core.c>\n\tOrder allow,deny\n\tDeny from all\n</IfModule>\n";

		$index = trailingslashit( $dir ) . 'index.php';
		if ( ! $fs->exists( $index ) ) {
			$fs->put_contents( $index, $silence, FS_CHMOD_FILE );
		}
		$parent_index = trailingslashit( dirname( $dir ) ) . 'index.php';
		if ( ! $fs->exists( $parent_index ) ) {
			$fs->put_contents( $parent_index, $silence, FS_CHMOD_FILE );
		}
		$ht = trailingslashit( $dir ) . '.htaccess';
		if ( ! $fs->exists( $ht ) ) {
			$fs->put_contents( $ht, $htaccess, FS_CHMOD_FILE );
		}
	}

	/**
	 * Initialize and return WP_Filesystem, or an error if it is unavailable.
	 *
	 * @return \WP_Filesystem_Base|\WP_Error
	 */
	private static function filesystem() {
		global $wp_filesystem;
		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( ! WP_Filesystem() ) {
			return new \WP_Error( 'bw_no_filesystem', 'WordPress could not access the filesystem directly.', array( 'status' => 500 ) );
		}
		return $wp_filesystem;
	}

	/**
	 * Read the value at $path in an array, or null.
	 *
	 * @param array $data Source.
	 * @param array $path Key path.
	 * @return mixed
	 */
	public static function get_in( $data, $path ) {
		foreach ( $path as $key ) {
			if ( ! is_array( $data ) || ! isset( $data[ $key ] ) ) {
				return null;
			}
			$data = $data[ $key ];
		}
		return $data;
	}

	/**
	 * Return $data with $value set at $path, creating intermediate arrays.
	 *
	 * @param array $data  Source.
	 * @param array $path  Key path.
	 * @param mixed $value Value.
	 * @return array
	 */
	public static function set_in( $data, $path, $value ) {
		$key = array_shift( $path );
		if ( empty( $path ) ) {
			$data[ $key ] = $value;
			return $data;
		}
		$data[ $key ] = self::set_in( isset( $data[ $key ] ) && is_array( $data[ $key ] ) ? $data[ $key ] : array(), $path, $value );
		return $data;
	}

	/**
	 * Return a copy of $data with $path removed, pruning parents that become empty.
	 *
	 * @param array $data Source array.
	 * @param array $path Key path.
	 * @return array
	 */
	private static function unset_by_path( $data, $path ) {
		if ( empty( $path ) ) {
			return $data;
		}
		$key  = $path[0];
		$rest = array_slice( $path, 1 );
		if ( ! isset( $data[ $key ] ) ) {
			return $data;
		}
		if ( empty( $rest ) ) {
			unset( $data[ $key ] );
			return $data;
		}
		if ( is_array( $data[ $key ] ) ) {
			$data[ $key ] = self::unset_by_path( $data[ $key ], $rest );
			if ( array() === $data[ $key ] ) {
				unset( $data[ $key ] );
			}
		}
		return $data;
	}
}
