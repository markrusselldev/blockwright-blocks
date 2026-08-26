<?php
/**
 * Block Bindings sources + the "Dynamic content" picker.
 *
 * WordPress ships the Block Bindings API (6.5+) but, verified vs core 7.0.2,
 * its user-facing UI offers exactly ONE source (registered post meta) behind a hidden-by-default
 * Attributes panel, and no source exists at all for the everyday fields: post
 * title/excerpt/date/author/featured image, site title/tagline/url. This module
 * registers those two sources and enqueues the picker UI (assets/js/
 * editor-bindings-picker.js) that surfaces them on the four bindable blocks
 * (paragraph, heading, image, button).
 *
 * Everything written into content is CORE markup (`metadata.bindings`): with
 * the plugin deactivated the block simply renders its stored static content
 * again - no lock-in (the block keeps its last saved content as fallback).
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\Bindings;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Resolve a field for the blockwright/post source.
 *
 * Mirrors core's own post-data source guards (wp-includes/block-bindings/
 * post-data.php): post id from block context, and no value for posts the
 * current visitor is not allowed to see.
 *
 * @param array     $source_args    Source args, e.g. array( 'field' => 'title' ).
 * @param \WP_Block $block_instance The block being rendered.
 * @return string|null Field value, or null to fall back to stored content.
 */
function get_post_field_value( array $source_args, $block_instance ) {
	if ( empty( $source_args['field'] ) ) {
		return null;
	}

	$post_id = isset( $block_instance->context['postId'] ) ? (int) $block_instance->context['postId'] : 0;
	if ( ! $post_id ) {
		return null;
	}

	$post = get_post( $post_id );
	if ( ! $post ) {
		return null;
	}
	if ( ( ! is_post_publicly_viewable( $post ) && ! current_user_can( 'read_post', $post_id ) ) || post_password_required( $post ) ) {
		return null;
	}

	switch ( $source_args['field'] ) {
		case 'title':
			return wp_kses_post( get_the_title( $post_id ) );
		case 'excerpt':
			return wp_kses_post( get_the_excerpt( $post_id ) );
		case 'date':
			return esc_html( get_the_date( '', $post_id ) );
		case 'author':
			$author = get_userdata( (int) $post->post_author );
			return $author ? esc_html( $author->display_name ) : null;
		case 'featured-image':
			$url = get_the_post_thumbnail_url( $post_id, 'full' );
			return $url ? esc_url( $url ) : null;
	}

	return null;
}

/**
 * Resolve a field for the blockwright/site source.
 *
 * @param array $source_args Source args, e.g. array( 'field' => 'title' ).
 * @return string|null Field value, or null to fall back to stored content.
 */
function get_site_field_value( array $source_args ) {
	if ( empty( $source_args['field'] ) ) {
		return null;
	}

	switch ( $source_args['field'] ) {
		case 'title':
			return esc_html( get_bloginfo( 'name' ) );
		case 'tagline':
			return esc_html( get_bloginfo( 'description' ) );
		case 'url':
			return esc_url( home_url() );
	}

	return null;
}

add_action(
	'init',
	function () {
		if ( ! function_exists( 'register_block_bindings_source' ) ) {
			return; // Pre-6.5 WordPress: no bindings API, the plugin's other features still work.
		}

		register_block_bindings_source(
			'blockwright/post',
			array(
				'label'              => __( 'Post (Blockwright)', 'blockwright-blocks' ),
				'get_value_callback' => __NAMESPACE__ . '\\get_post_field_value',
				'uses_context'       => array( 'postId', 'postType' ),
			)
		);

		register_block_bindings_source(
			'blockwright/site',
			array(
				'label'              => __( 'Site (Blockwright)', 'blockwright-blocks' ),
				'get_value_callback' => __NAMESPACE__ . '\\get_site_field_value',
			)
		);
	}
);

add_action(
	'enqueue_block_editor_assets',
	function () {
		if ( ! function_exists( 'register_block_bindings_source' ) ) {
			return;
		}

		$js = BLOCKWRIGHT_BLOCKS_DIR . 'assets/js/editor-bindings-picker.js';
		if ( ! file_exists( $js ) ) {
			return;
		}

		wp_enqueue_script(
			'blockwright-bindings-picker',
			BLOCKWRIGHT_BLOCKS_URL . 'assets/js/editor-bindings-picker.js',
			array( 'wp-blocks', 'wp-block-editor', 'wp-components', 'wp-element', 'wp-i18n', 'wp-hooks', 'wp-compose', 'wp-data', 'wp-date' ),
			(string) filemtime( $js ),
			true
		);

		if ( function_exists( 'wp_set_script_translations' ) ) {
			wp_set_script_translations( 'blockwright-bindings-picker', 'blockwright-blocks' );
		}
	}
);
