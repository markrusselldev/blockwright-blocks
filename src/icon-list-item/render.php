<?php
/**
 * Server render for blockwright/icon-list-item.
 *
 * The icon is stored as a NAME and resolved to SVG here via wp_get_icon() (the Blockwright
 * collection is registered into core's Icons registry in inc/icons.php) - so no SVG is written
 * into post content. On WP < 7.1 wp_get_icon() does not exist; the row then renders text-only
 * (graceful). The SVG is registry-sourced and sanitized on registration, so it is echoed as-is.
 *
 * @package Blockwright_Blocks
 *
 * @var array $attributes Block attributes.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$blockwright_blocks_icon   = isset( $attributes['icon'] ) ? $attributes['icon'] : '';
$blockwright_blocks_custom = isset( $attributes['customSvg'] ) ? $attributes['customSvg'] : '';
if ( '' !== $blockwright_blocks_custom ) {
	$blockwright_blocks_svg = \Blockwright_Blocks\Icons\sanitize_svg( $blockwright_blocks_custom );
} else {
	$blockwright_blocks_svg = ( $blockwright_blocks_icon && function_exists( 'wp_get_icon' ) ) ? wp_get_icon( $blockwright_blocks_icon, array( 'size' => null ) ) : '';
}
$blockwright_blocks_text = isset( $attributes['text'] ) ? $attributes['text'] : '';
$blockwright_blocks_wrap = get_block_wrapper_attributes( array( 'class' => 'bw-icon-list__item' ) );

// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped -- $blockwright_blocks_wrap is escaped by core; $blockwright_blocks_svg is registry-sanitized SVG.
?>
<li <?php echo $blockwright_blocks_wrap; ?>>
<?php
if ( '' !== $blockwright_blocks_svg ) :
	?>
	<span class="bw-icon-list__icon"><?php echo $blockwright_blocks_svg; ?></span><?php endif; ?><span class="bw-icon-list__text"><?php echo wp_kses_post( $blockwright_blocks_text ); ?></span></li>
<?php
// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped
