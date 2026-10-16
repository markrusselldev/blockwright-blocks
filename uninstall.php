<?php
/**
 * Uninstall: remove the data this plugin stores.
 *
 * Runs only when the plugin is deleted from the Plugins screen, never on deactivation, so a
 * deactivated plugin keeps its applied design and restore points. Removes the applied-design
 * option, the restore-point folder under uploads, and the install date and per-user notice and
 * review state. A look the owner copied into site styles lives in WordPress's own Global
 * Styles record and is left alone.
 *
 * @package Blockwright_Blocks
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Remove this plugin's data for the current site.
 */
function blockwright_blocks_uninstall_site() {
	delete_option( 'blockwright_blocks_design' );
	delete_option( 'blockwright_blocks_installed' );

	$uploads = wp_upload_dir( null, false );
	$parent  = trailingslashit( $uploads['basedir'] ) . 'blockwright';
	$dir     = $parent . '/snapshots';
	if ( ! is_dir( $dir ) ) {
		return;
	}
	if ( ! function_exists( 'WP_Filesystem' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	global $wp_filesystem;
	if ( ! WP_Filesystem() ) {
		return;
	}
	$wp_filesystem->rmdir( $dir, true );
	// The parent holds only the index.php written to stop directory listing; drop it if so.
	$left = array_diff( (array) scandir( $parent ), array( '.', '..', 'index.php' ) );
	if ( empty( $left ) ) {
		$wp_filesystem->rmdir( $parent, true );
	}
}

// Per-user notice and review state (user meta is network-wide, so once is enough).
delete_metadata( 'user', 0, 'blockwright_blocks_companion_dismissed', '', true );
delete_metadata( 'user', 0, 'blockwright_blocks_review', '', true );

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids' ) ) as $blockwright_blocks_site_id ) {
		switch_to_blog( $blockwright_blocks_site_id );
		blockwright_blocks_uninstall_site();
		restore_current_blog();
	}
} else {
	blockwright_blocks_uninstall_site();
}
