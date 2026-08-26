<?php
/**
 * Server render for blockwright/icon-box.
 *
 * The icon is stored as a NAME and resolved to SVG here via wp_get_icon() (the Blockwright
 * collection is registered into core's Icons registry in inc/icons.php) - so no SVG is written
 * into post content. On WP < 7.1 wp_get_icon() does not exist; the box then renders without the
 * icon (graceful). Box chrome (padding, border, radius, background, shadow, alignment) is core
 * block supports, applied via get_block_wrapper_attributes(). SVG is registry-sanitized.
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
$blockwright_blocks_heading   = isset( $attributes['heading'] ) ? $attributes['heading'] : '';
$blockwright_blocks_text      = isset( $attributes['text'] ) ? $attributes['text'] : '';
$blockwright_blocks_link_text = isset( $attributes['linkText'] ) ? $attributes['linkText'] : '';
$blockwright_blocks_link_url  = isset( $attributes['linkUrl'] ) ? $attributes['linkUrl'] : '';
$blockwright_blocks_center    = isset( $attributes['alignment'] ) && 'center' === $attributes['alignment'];
$blockwright_blocks_position  = isset( $attributes['iconPosition'] ) ? $attributes['iconPosition'] : 'top';
$blockwright_blocks_size      = isset( $attributes['iconSize'] ) ? $attributes['iconSize'] : 'large';
$blockwright_blocks_valign    = isset( $attributes['verticalAlignment'] ) ? $attributes['verticalAlignment'] : '';
$blockwright_blocks_is_row    = ( 'left' === $blockwright_blocks_position || 'right' === $blockwright_blocks_position );
$blockwright_blocks_classes   = 'bw-icon-box'
	. ' is-position-' . sanitize_html_class( $blockwright_blocks_position )
	. ' is-icon-' . sanitize_html_class( $blockwright_blocks_size )
	. ( $blockwright_blocks_center ? ' is-align-center' : '' )
	. ( ( $blockwright_blocks_is_row && '' !== $blockwright_blocks_valign ) ? ' is-vertically-aligned-' . sanitize_html_class( $blockwright_blocks_valign ) : '' );
$blockwright_blocks_attrs     = array( 'class' => $blockwright_blocks_classes );
// Keep a Left/Right icon on its physical side in RTL: the grid columns follow `direction`, so the
// container is pinned to LTR (text direction is reset on the children in style.scss). Inline, not
// CSS, because rtlcss would flip a stylesheet `direction: ltr` in the generated RTL sheet.
if ( $blockwright_blocks_is_row ) {
	$blockwright_blocks_attrs['style'] = 'direction:ltr;';
}
$blockwright_blocks_wrap = get_block_wrapper_attributes( $blockwright_blocks_attrs );

// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped -- $blockwright_blocks_wrap is escaped by core; $blockwright_blocks_svg is registry-sanitized SVG.
?>
<div <?php echo $blockwright_blocks_wrap; ?>>
	<?php
	if ( '' !== $blockwright_blocks_svg ) :
		?>
		<span class="bw-icon-box__icon"><?php echo $blockwright_blocks_svg; ?></span><?php endif; ?>
	<div class="bw-icon-box__content">
		<h3 class="bw-icon-box__heading"><?php echo wp_kses_post( $blockwright_blocks_heading ); ?></h3>
		<p class="bw-icon-box__text"><?php echo wp_kses_post( $blockwright_blocks_text ); ?></p>
		<?php
		if ( '' !== $blockwright_blocks_link_text ) :
			?>
			<a class="bw-icon-box__link" href="<?php echo esc_url( $blockwright_blocks_link_url ? $blockwright_blocks_link_url : '#' ); ?>"><?php echo esc_html( $blockwright_blocks_link_text ); ?></a><?php endif; ?>
	</div>
</div>
<?php
// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped
