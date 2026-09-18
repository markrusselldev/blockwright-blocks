<?php
/**
 * Design-system control plane: the write engine - the one and only door that changes
 * the design source of truth.
 *
 * There is no core function that writes theme.json to disk (the resolver is read-only),
 * so we follow the approach the first-party Create Block Theme plugin uses: write the
 * changed slice into the active theme's theme.json file, then surgically clear just the
 * keys we wrote from the user Global Styles record so the file value is what renders.
 * Every write snapshots first, so any change is reversible.
 *
 * Order of the layers WordPress merges design data: core < theme.json file < the user's
 * Site-Editor record (a wp_global_styles post). The user record wins, so after writing
 * the file we clear ONLY the keys we changed from that record - surgically, leaving the
 * user's unrelated Site-Editor work intact.
 *
 * The category being written (which path in theme.json it owns, replace vs merge) comes
 * from the registry, so this engine is not color-specific: every ability writes through
 * it.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\DesignSystem;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The write engine. Static methods; there is no state to hold between calls beyond the
 * files it reads and writes.
 */
class Write_Engine {

	/**
	 * Newest auto restore points to keep on disk PER MODULE (color, typography, ...); older
	 * ones of the SAME module are pruned after each new snapshot, so one module's churn never
	 * evicts another's restore points. The pristine "original" baseline is never counted or
	 * pruned. 50 is generous on purpose - a snapshot is ~48 KB, so 50/module is a few MB, and
	 * pruning is permanent (no recycle bin), so the cap exists to bound growth, not to save space.
	 */
	const MAX_AUTO_SNAPSHOTS_PER_MODULE = 50;

	/**
	 * Write a category's value into the active theme's theme.json, then clear the
	 * matching keys from the user Global Styles record so the file value renders.
	 * Snapshots the current state first.
	 *
	 * @param string $category Registry category key, e.g. 'color'.
	 * @param mixed  $value    The value to write at the category's theme.json path.
	 * @param string $label    Optional human label for the automatic snapshot.
	 * @return array|\WP_Error { snapshot: string } on success, WP_Error on failure.
	 */
	public static function write( $category, $value, $label = '' ) {
		$entry = get_category( $category );
		if ( null === $entry || empty( $entry['path'] ) ) {
			return new \WP_Error( 'bw_unknown_category', "Unknown design-system category: $category", array( 'status' => 400 ) );
		}
		$path  = $entry['path'];
		$file  = self::theme_json_path();
		$check = self::read_theme_json();
		if ( is_wp_error( $check ) ) {
			return $check;
		}
		if ( ! self::is_writable() ) {
			return new \WP_Error( 'bw_theme_not_writable', "The active theme's theme.json is not writable by WordPress on this host.", array( 'status' => 409 ) );
		}

		// Keep a pristine "original" restore point, once, before the first change ever.
		self::capture_original();

		// Decode as OBJECTS so empty objects ({}) elsewhere in the file are preserved (a
		// full associative decode rewrites every {} as []); set only this category's path,
		// so the write changes that slice and leaves the rest of the file untouched.
		$tree = wp_json_file_decode( $file );
		if ( ! is_object( $tree ) ) {
			return new \WP_Error( 'bw_bad_theme_json', 'theme.json could not be parsed.', array( 'status' => 500 ) );
		}
		self::set_by_path_obj( $tree, $path, $value );
		$written = self::write_theme_json_locked( $tree );
		if ( is_wp_error( $written ) ) {
			return $written;
		}

		// Surgically clear the same keys from the user Global Styles record.
		self::clear_user_override( $path );

		// Recompute merged data. Note: the file itself is re-read on the NEXT request
		// (core memoizes theme.json by path for the life of a request with no reset
		// hook), so callers should refetch rather than read merged data back here.
		if ( function_exists( 'wp_clean_theme_json_cache' ) ) {
			wp_clean_theme_json_cache();
		}
		self::purge_caches();

		// Snapshot the APPLIED state, labeled "<Module>: <what changed>" so a restore point reads
		// as a full checkpoint of the whole theme.json taken when that module changed - the module
		// prefix is added here so every ability gets it for free. Restoring this point returns to
		// THIS look, not the state before it (the pristine baseline is original.json).
		$change   = '' !== (string) $label ? $label : __( 'applied', 'blockwright-blocks' );
		$display  = self::category_label( $category ) . ': ' . $change;
		$snapshot = self::snapshot( $display, $category );
		if ( is_wp_error( $snapshot ) ) {
			return $snapshot;
		}

		return array( 'snapshot' => basename( $snapshot ) );
	}

	/**
	 * Restore a snapshot: rewrite theme.json and the user Global Styles record to the
	 * captured state.
	 *
	 * @param string $id Snapshot file name (e.g. 'original.json' or an auto snapshot).
	 * @return true|\WP_Error
	 */
	public static function restore( $id ) {
		$id   = basename( (string) $id );
		$file = trailingslashit( self::snapshots_dir() ) . $id;
		if ( ! is_readable( $file ) ) {
			return new \WP_Error( 'bw_snapshot_missing', "Snapshot not found: $id", array( 'status' => 404 ) );
		}
		$snap = wp_json_file_decode( $file, array( 'associative' => true ) );
		if ( ! is_array( $snap ) || ( ! isset( $snap['theme_json_raw'] ) && ! isset( $snap['theme_json'] ) ) ) {
			return new \WP_Error( 'bw_snapshot_invalid', "Snapshot is unreadable: $id", array( 'status' => 422 ) );
		}
		if ( ! self::is_writable() ) {
			return new \WP_Error( 'bw_theme_not_writable', 'theme.json is not writable on this host.', array( 'status' => 409 ) );
		}
		// Prefer the raw bytes (byte-perfect restore); older snapshots stored a decoded copy.
		$written = isset( $snap['theme_json_raw'] )
			? self::write_theme_json_raw( (string) $snap['theme_json_raw'] )
			: self::write_theme_json_locked( $snap['theme_json'] );
		if ( is_wp_error( $written ) ) {
			return $written;
		}
		self::restore_user_override( $snap['user_global_styles'] ?? null );
		if ( function_exists( 'wp_clean_theme_json_cache' ) ) {
			wp_clean_theme_json_cache();
		}
		self::purge_caches();
		return true;
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
			$snap  = wp_json_file_decode( $file, array( 'associative' => true ) );
			$out[] = array(
				'id'       => basename( $file ),
				'label'    => is_array( $snap ) && isset( $snap['label'] ) ? $snap['label'] : '',
				'category' => is_array( $snap ) && isset( $snap['category'] ) ? (string) $snap['category'] : '',
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
		if ( 'original.json' === $id ) {
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
	 * Absolute path to the active theme's theme.json.
	 *
	 * @return string
	 */
	private static function theme_json_path() {
		return trailingslashit( get_stylesheet_directory() ) . 'theme.json';
	}

	/**
	 * Read and decode the active theme's theme.json.
	 *
	 * @return array|\WP_Error
	 */
	private static function read_theme_json() {
		$file = self::theme_json_path();
		if ( ! is_readable( $file ) ) {
			return new \WP_Error( 'bw_no_theme_json', 'The active theme has no readable theme.json.', array( 'status' => 409 ) );
		}
		$data = wp_json_file_decode( $file, array( 'associative' => true ) );
		if ( ! is_array( $data ) ) {
			return new \WP_Error( 'bw_bad_theme_json', 'theme.json could not be parsed.', array( 'status' => 500 ) );
		}
		return $data;
	}

	/**
	 * Whether theme.json can be written on this host.
	 *
	 * @return bool
	 */
	private static function is_writable() {
		$file = self::theme_json_path();
		return file_exists( $file ) ? wp_is_writable( $file ) : wp_is_writable( dirname( $file ) );
	}

	/**
	 * Write theme.json using WP_Filesystem, guarded by a sibling .lock so two writes
	 * cannot interleave.
	 *
	 * The lock is a deliberate BEST-EFFORT advisory guard, not a true mutex: WP_Filesystem
	 * exposes no atomic exclusive-create, so the exists-check/write is not race-free. That is
	 * sufficient here - the write path is admin-only (`edit_theme_options`) and single-operator,
	 * so concurrent writes are a near-impossibility rather than a threat; the stale-lock timeout
	 * below keeps a crashed write from wedging the tool. It is intentionally not hardened further.
	 *
	 * @param array $data Full theme.json data to encode and write.
	 * @return true|\WP_Error
	 */
	private static function write_theme_json_locked( $data ) {
		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}
		$file = self::theme_json_path();
		$lock = $file . '.lock';
		// A stale lock older than 30s is ignored (a crashed write should not wedge us).
		if ( $fs->exists( $lock ) ) {
			$age = time() - (int) $fs->mtime( $lock );
			if ( $age >= 0 && $age < 30 ) {
				return new \WP_Error( 'bw_write_locked', 'Another design write is in progress; try again.', array( 'status' => 409 ) );
			}
		}
		$fs->put_contents( $lock, (string) time(), FS_CHMOD_FILE );
		// Re-encode matching the file's own indentation, so a write changes only the
		// values it touches and leaves the rest of the file byte-identical (a minimal diff
		// on git-tracked themes, ours included), rather than reformatting every line.
		$existing = $fs->exists( $file ) ? (string) $fs->get_contents( $file ) : '';
		$json     = wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		$json     = self::reindent( $json, self::detect_indent( $existing ) );
		// Match the file's existing trailing-newline (ours has none) so the diff is only
		// the changed values, not an added blank line.
		$eol = ( '' !== $existing && "\n" === substr( $existing, -1 ) ) ? "\n" : '';
		$ok  = $fs->put_contents( $file, $json . $eol, FS_CHMOD_FILE );
		$fs->delete( $lock );
		if ( ! $ok ) {
			return new \WP_Error( 'bw_write_failed', 'Writing theme.json failed.', array( 'status' => 500 ) );
		}
		return true;
	}

	/**
	 * Detect the one-level indentation unit of an existing JSON file (tab, or N spaces),
	 * so a rewrite matches it. Falls back to two spaces.
	 *
	 * @param string $text File contents.
	 * @return string One indentation unit.
	 */
	private static function detect_indent( $text ) {
		if ( preg_match( '/\n(\t+| +)\S/', (string) $text, $m ) ) {
			return "\t" === $m[1][0] ? "\t" : $m[1];
		}
		return '  ';
	}

	/**
	 * Re-indent wp_json_encode PRETTY_PRINT output (4 spaces per level) to use $unit per
	 * level instead. Only leading structural spaces are touched; JSON strings never begin
	 * a line, so values are left alone.
	 *
	 * @param string $json JSON with 4-space indentation.
	 * @param string $unit Indentation unit to use per level.
	 * @return string
	 */
	private static function reindent( $json, $unit ) {
		if ( '    ' === $unit ) {
			return $json;
		}
		return preg_replace_callback(
			'/^( +)/m',
			static function ( $m ) use ( $unit ) {
				return str_repeat( $unit, intdiv( strlen( $m[1] ), 4 ) );
			},
			$json
		);
	}

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
	 * Take a snapshot of the current theme.json + user Global Styles record.
	 *
	 * @param string $label Human label.
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
		$label = isset( $snap['label'] ) ? (string) $snap['label'] : '';
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
	 * Capture the pristine original once (before our first edit ever). Idempotent.
	 */
	private static function capture_original() {
		$file = trailingslashit( self::snapshots_dir() ) . 'original.json';
		if ( ! file_exists( $file ) ) {
			self::write_snapshot(
				'original.json',
				__( 'original (before first change)', 'blockwright-blocks' )
			);
		}
	}

	/**
	 * Write a snapshot file capturing current state.
	 *
	 * @param string $name  File name.
	 * @param string $label Human label.
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
		// Store the raw theme.json TEXT, not a decoded copy, so a restore rewrites the
		// exact original bytes (formatting and empty objects included), not a re-encode.
		$theme_json_raw = $fs->exists( self::theme_json_path() )
			? (string) $fs->get_contents( self::theme_json_path() )
			: '';
		$post_id        = self::user_global_styles_post_id();
		$snap           = array(
			'time'               => microtime( true ),
			'label'              => (string) $label,
			'category'           => (string) $category,
			'theme'              => get_stylesheet(),
			'theme_json_raw'     => $theme_json_raw,
			'user_global_styles' => $post_id ? (string) get_post( $post_id )->post_content : null,
		);
		$path           = trailingslashit( $dir ) . $name;
		$ok             = $fs->put_contents( $path, wp_json_encode( $snap, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ), FS_CHMOD_FILE );
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
	 *   all`). Inert on nginx, which ignores it - hosts there rely on the index.php + the
	 *   unguessable-by-default nature and the low sensitivity of the data.
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
	 * Set $value at $path in an object-decoded theme.json tree (creating intermediate
	 * objects). Mutates $tree in place (stdClass is by-reference).
	 *
	 * @param object $tree  Object tree from wp_json_file_decode().
	 * @param array  $path  Key path.
	 * @param mixed  $value Value to set.
	 */
	private static function set_by_path_obj( $tree, $path, $value ) {
		$ref  = $tree;
		$last = array_pop( $path );
		foreach ( $path as $key ) {
			if ( ! isset( $ref->$key ) || ! is_object( $ref->$key ) ) {
				$ref->$key = new \stdClass();
			}
			$ref = $ref->$key;
		}
		$ref->$last = $value;
	}

	/**
	 * Write raw theme.json bytes verbatim (used by restore, so the exact original file is
	 * put back). No re-encode.
	 *
	 * @param string $text Full file contents.
	 * @return true|\WP_Error
	 */
	private static function write_theme_json_raw( $text ) {
		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}
		$ok = $fs->put_contents( self::theme_json_path(), $text, FS_CHMOD_FILE );
		return $ok ? true : new \WP_Error( 'bw_write_failed', 'Writing theme.json failed.', array( 'status' => 500 ) );
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
