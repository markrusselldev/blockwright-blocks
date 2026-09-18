<?php
/**
 * Curated icon collection for core's Icon block.
 *
 * WordPress 7.1 opened the icon registry (Icons API, changeset 62748, verified
 * against 7.1-RC1 2026-08-06): `wp_register_icon_collection()` +
 * `wp_register_icon()` let a plugin add its own namespaced collection, which
 * appears as its own tab in core's own icon picker. So this ships icons INTO
 * core's Icon block rather than adding a custom block - maximum core alignment,
 * zero new UI to maintain.
 *
 * Curation principle: do NOT duplicate core's own set. Every icon here fills a
 * gap in core's set that a business or agency site actually needs. The icons
 * are grouped by the JOB they do on a site (contact, commerce, trust, data,
 * workflow, technical, content, office) and were selected against Phosphor's own
 * category metadata, not by eye.
 *
 * Source: Phosphor REGULAR weight (MIT, GPL-compatible) - the outline look, to
 * sit comfortably beside core's own outline-style icons and to stay legible at
 * the 24px the Icon block renders by default (the solid weight closes up into a
 * blob at that size).
 *
 * IMPORTANT constraint, easy to get wrong: what core forbids is STROKES, not the
 * outline LOOK. `wp_register_icon()` sanitizes through a wp_kses allowlist that
 * permits no stroke attributes anywhere, so genuinely stroke-drawn sets (Tabler
 * outline, Feather, Lucide) arrive as filled blobs. Phosphor draws BOTH weights
 * as filled paths, so its outline weight passes untouched. Color comes from the Icon
 * block's own CSS (fill: currentColor), so icons inherit theme token colors.
 *
 * Front-end cost is zero at any set size: the block stores only the icon NAME and
 * renders the SVG server-side, so a page's HTML inlines just the icons it uses (no
 * sprite or font request), and post_content never carries the SVG. The EDITOR cost is why this is curated
 * rather than the full 1,512-icon library: core's picker fetches a whole
 * collection in one request with no pagination (`supportsPagination: false` in
 * core-data; the REST endpoint's page/per_page params are stubs that do nothing,
 * measured 2026-08-06), so the full set would be an 803 KB fetch against core's
 * own 33 KB. This set measures ~81 KB.
 *
 * Everything is guarded by function_exists, so on WordPress 7.0 and earlier the
 * plugin simply does not register a collection and core's Icon block behaves as
 * it always did.
 *
 * @package Blockwright_Blocks
 */

namespace Blockwright_Blocks\Icons;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const COLLECTION = 'blockwright';

/**
 * Sanitize a user-supplied inline SVG for the icon-bearing blocks' "Custom SVG" field.
 *
 * A tight wp_kses allowlist: SVG shape/presentation elements and their geometry/paint
 * attributes only - no <script>, <style>, <foreignObject>, event handlers, or hrefs, so it
 * carries no script vector. UNLIKE core's own icon kses (which strips strokes and turns
 * stroke-drawn icons into filled blobs), this KEEPS stroke-* so a user's own outline SVG
 * renders as intended - the field is the user's deliberate choice, and stroke attributes are
 * presentation, not a security risk. Called on RENDER, so storage never has to be trusted.
 *
 * @param string $svg Raw SVG markup.
 * @return string Sanitized SVG (empty string if nothing survives).
 */
function sanitize_svg( $svg ) {
	$paint   = array(
		'fill'             => true,
		'fill-rule'        => true,
		'fill-opacity'     => true,
		'clip-rule'        => true,
		'stroke'           => true,
		'stroke-width'     => true,
		'stroke-linecap'   => true,
		'stroke-linejoin'  => true,
		'stroke-dasharray' => true,
		'stroke-opacity'   => true,
		'opacity'          => true,
		'transform'        => true,
	);
	$allowed = array(
		'svg'      => array_merge(
			$paint,
			array(
				'xmlns'       => true,
				'viewbox'     => true,
				'width'       => true,
				'height'      => true,
				'role'        => true,
				'aria-hidden' => true,
				'focusable'   => true,
				'class'       => true,
			)
		),
		'g'        => $paint,
		'path'     => array_merge( $paint, array( 'd' => true ) ),
		'circle'   => array_merge(
			$paint,
			array(
				'cx' => true,
				'cy' => true,
				'r'  => true,
			)
		),
		'ellipse'  => array_merge(
			$paint,
			array(
				'cx' => true,
				'cy' => true,
				'rx' => true,
				'ry' => true,
			)
		),
		'rect'     => array_merge(
			$paint,
			array(
				'x'      => true,
				'y'      => true,
				'width'  => true,
				'height' => true,
				'rx'     => true,
				'ry'     => true,
			)
		),
		'line'     => array_merge(
			$paint,
			array(
				'x1' => true,
				'y1' => true,
				'x2' => true,
				'y2' => true,
			)
		),
		'polygon'  => array_merge( $paint, array( 'points' => true ) ),
		'polyline' => array_merge( $paint, array( 'points' => true ) ),
	);
	return wp_kses( (string) $svg, $allowed );
}

/**
 * The curated set: slug => human-readable label.
 *
 * Each slug must have a matching assets/icons/<slug>.svg. Keep labels short and
 * plain: they are what a user reads in core's icon picker.
 *
 * Outline is the default. A FILLED variant exists only where the fill carries
 * STATE or an action MODE, never decoration - which is exactly how core uses it
 * (core ships star-empty / star-half / star-filled and symbol-filled, and
 * nothing else filled; gutenberg#65786: "sometimes this makes sense (for example
 * there should be filled/unfilled star icons), but generally it would help to
 * standardize").
 *
 * 133 of these icons have a filled twin available upstream; 11 earn one. The
 * full pass (2026-08-06), so the rule is auditable rather than a matter of
 * taste:
 *   - RATING scale: star / star-half / star-fill (mirrors core exactly).
 *   - SAVED or FAVOURITED: heart, bookmark.
 *   - APPROVAL: thumbs-up (voted).
 *   - STATUS: check-circle (success) and x-circle (error) - kept as a pair so a
 *     status row does not mix weights.
 *   - VERIFIED / PROTECTED badges: seal-check, shield-check.
 *   - TRANSPORT: play, pause - solid is the universal convention for media
 *     controls, and filled reads as the active mode.
 * DELIBERATELY EXCLUDED, with reasons: eye and lock (their opposite is
 * eye-slash / lock-open, so fill carries nothing); trophy, medal, certificate
 * (achievement icons read as decoration here, not as an on/off state);
 * fingerprint, target, gauge, calendar-check (no binary counterpart); plain
 * check, plus, minus, arrows and carets (glyphs, not states). Do not add a
 * filled twin just because it exists upstream.
 *
 * @return array<string, string>
 */
function icons() {
	return array(
		// Contact & location.
		'phone'              => __( 'Phone', 'blockwright-blocks' ),
		'envelope-simple'    => __( 'Envelope', 'blockwright-blocks' ),
		'chat-circle'        => __( 'Chat', 'blockwright-blocks' ),
		'chats-circle'       => __( 'Chats', 'blockwright-blocks' ),
		'map-pin'            => __( 'Map pin', 'blockwright-blocks' ),
		'map-trifold'        => __( 'Map', 'blockwright-blocks' ),
		'paper-plane-tilt'   => __( 'Paper plane', 'blockwright-blocks' ),
		'at'                 => __( 'At sign', 'blockwright-blocks' ),
		'headset'            => __( 'Headset', 'blockwright-blocks' ),
		'clock'              => __( 'Clock', 'blockwright-blocks' ),
		'calendar-blank'     => __( 'Calendar', 'blockwright-blocks' ),
		'calendar-check'     => __( 'Calendar check', 'blockwright-blocks' ),
		'user'               => __( 'User', 'blockwright-blocks' ),
		'users'              => __( 'Users', 'blockwright-blocks' ),
		'user-circle'        => __( 'User avatar', 'blockwright-blocks' ),
		'address-book'       => __( 'Address book', 'blockwright-blocks' ),
		'voicemail'          => __( 'Voicemail', 'blockwright-blocks' ),
		'video-camera'       => __( 'Video camera', 'blockwright-blocks' ),

		// Commerce & money.
		'shopping-cart'      => __( 'Shopping cart', 'blockwright-blocks' ),
		'shopping-bag'       => __( 'Shopping bag', 'blockwright-blocks' ),
		'tag'                => __( 'Tag', 'blockwright-blocks' ),
		'receipt'            => __( 'Receipt', 'blockwright-blocks' ),
		'credit-card'        => __( 'Credit card', 'blockwright-blocks' ),
		'currency-dollar'    => __( 'Dollar', 'blockwright-blocks' ),
		'wallet'             => __( 'Wallet', 'blockwright-blocks' ),
		'package'            => __( 'Package', 'blockwright-blocks' ),
		'truck'              => __( 'Truck', 'blockwright-blocks' ),
		'storefront'         => __( 'Storefront', 'blockwright-blocks' ),
		'gift'               => __( 'Gift', 'blockwright-blocks' ),
		'percent'            => __( 'Percent', 'blockwright-blocks' ),
		'barcode'            => __( 'Barcode', 'blockwright-blocks' ),
		'hand-coins'         => __( 'Payment', 'blockwright-blocks' ),

		// Trust & proof.
		'shield-check'       => __( 'Shield', 'blockwright-blocks' ),
		'shield-check-fill'  => __( 'Shield filled', 'blockwright-blocks' ),
		'seal-check'         => __( 'Verified', 'blockwright-blocks' ),
		'seal-check-fill'    => __( 'Verified filled', 'blockwright-blocks' ),
		'certificate'        => __( 'Certificate', 'blockwright-blocks' ),
		'trophy'             => __( 'Trophy', 'blockwright-blocks' ),
		'medal'              => __( 'Medal', 'blockwright-blocks' ),
		'star'               => __( 'Star', 'blockwright-blocks' ),
		'star-half'          => __( 'Star half', 'blockwright-blocks' ),
		'star-fill'          => __( 'Star filled', 'blockwright-blocks' ),
		'thumbs-up'          => __( 'Thumbs up', 'blockwright-blocks' ),
		'thumbs-up-fill'     => __( 'Thumbs up filled', 'blockwright-blocks' ),
		'heart'              => __( 'Heart', 'blockwright-blocks' ),
		'heart-fill'         => __( 'Heart filled', 'blockwright-blocks' ),
		'handshake'          => __( 'Handshake', 'blockwright-blocks' ),
		'lock'               => __( 'Lock', 'blockwright-blocks' ),
		'lock-key'           => __( 'Lock key', 'blockwright-blocks' ),
		'fingerprint'        => __( 'Fingerprint', 'blockwright-blocks' ),
		'scales'             => __( 'Scales', 'blockwright-blocks' ),

		// Data & reporting.
		'chart-line-up'      => __( 'Line chart', 'blockwright-blocks' ),
		'chart-bar'          => __( 'Chart bar', 'blockwright-blocks' ),
		'chart-pie-slice'    => __( 'Pie chart', 'blockwright-blocks' ),
		'trend-up'           => __( 'Trend up', 'blockwright-blocks' ),
		'trend-down'         => __( 'Trend down', 'blockwright-blocks' ),
		'gauge'              => __( 'Gauge', 'blockwright-blocks' ),
		'target'             => __( 'Target', 'blockwright-blocks' ),
		'list-checks'        => __( 'Checklist', 'blockwright-blocks' ),
		'clipboard-text'     => __( 'Clipboard', 'blockwright-blocks' ),
		'presentation-chart' => __( 'Presentation', 'blockwright-blocks' ),
		'table'              => __( 'Table', 'blockwright-blocks' ),
		'funnel'             => __( 'Funnel', 'blockwright-blocks' ),

		// Process & workflow.
		'arrow-right'        => __( 'Arrow right', 'blockwright-blocks' ),
		'arrow-left'         => __( 'Arrow left', 'blockwright-blocks' ),
		'arrow-up'           => __( 'Arrow up', 'blockwright-blocks' ),
		'arrow-down'         => __( 'Arrow down', 'blockwright-blocks' ),
		'check'              => __( 'Check', 'blockwright-blocks' ),
		'check-circle'       => __( 'Check circle', 'blockwright-blocks' ),
		'check-circle-fill'  => __( 'Check circle filled', 'blockwright-blocks' ),
		'x-circle'           => __( 'Close', 'blockwright-blocks' ),
		'x-circle-fill'      => __( 'Close filled', 'blockwright-blocks' ),
		'plus'               => __( 'Plus', 'blockwright-blocks' ),
		'minus'              => __( 'Minus', 'blockwright-blocks' ),
		'caret-right'        => __( 'Caret right', 'blockwright-blocks' ),
		'caret-down'         => __( 'Caret down', 'blockwright-blocks' ),
		'arrows-clockwise'   => __( 'Refresh', 'blockwright-blocks' ),
		'arrow-clockwise'    => __( 'Rotate', 'blockwright-blocks' ),
		'play'               => __( 'Play', 'blockwright-blocks' ),
		'play-fill'          => __( 'Play filled', 'blockwright-blocks' ),
		'pause'              => __( 'Pause', 'blockwright-blocks' ),
		'pause-fill'         => __( 'Pause filled', 'blockwright-blocks' ),
		'dots-three'         => __( 'More', 'blockwright-blocks' ),

		// Technical & dev.
		'code'               => __( 'Code', 'blockwright-blocks' ),
		'code-block'         => __( 'Code block', 'blockwright-blocks' ),
		'terminal-window'    => __( 'Terminal', 'blockwright-blocks' ),
		'bug'                => __( 'Bug', 'blockwright-blocks' ),
		'git-branch'         => __( 'Git branch', 'blockwright-blocks' ),
		'database'           => __( 'Database', 'blockwright-blocks' ),
		'cloud'              => __( 'Cloud', 'blockwright-blocks' ),
		'cloud-arrow-up'     => __( 'Cloud upload', 'blockwright-blocks' ),
		'plug'               => __( 'Plug', 'blockwright-blocks' ),
		'gear'               => __( 'Gear', 'blockwright-blocks' ),
		'gear-six'           => __( 'Settings', 'blockwright-blocks' ),
		'wrench'             => __( 'Wrench', 'blockwright-blocks' ),
		'hammer'             => __( 'Hammer', 'blockwright-blocks' ),
		'cpu'                => __( 'Cpu', 'blockwright-blocks' ),
		'stack'              => __( 'Stack', 'blockwright-blocks' ),
		'lightning'          => __( 'Lightning', 'blockwright-blocks' ),
		'wifi-high'          => __( 'Wi-Fi', 'blockwright-blocks' ),
		'globe'              => __( 'Globe', 'blockwright-blocks' ),
		'link'               => __( 'Link', 'blockwright-blocks' ),
		'link-simple'        => __( 'Link (plain)', 'blockwright-blocks' ),
		'browser'            => __( 'Browser', 'blockwright-blocks' ),
		'device-mobile'      => __( 'Mobile', 'blockwright-blocks' ),
		'desktop'            => __( 'Desktop', 'blockwright-blocks' ),
		'hard-drives'        => __( 'Storage', 'blockwright-blocks' ),

		// Content & media.
		'image'              => __( 'Image', 'blockwright-blocks' ),
		'images'             => __( 'Images', 'blockwright-blocks' ),
		'file'               => __( 'File', 'blockwright-blocks' ),
		'file-text'          => __( 'Text file', 'blockwright-blocks' ),
		'file-pdf'           => __( 'PDF file', 'blockwright-blocks' ),
		'folder'             => __( 'Folder', 'blockwright-blocks' ),
		'folder-open'        => __( 'Folder open', 'blockwright-blocks' ),
		'note-pencil'        => __( 'Note', 'blockwright-blocks' ),
		'pencil-simple'      => __( 'Pencil', 'blockwright-blocks' ),
		'paperclip'          => __( 'Paperclip', 'blockwright-blocks' ),
		'printer'            => __( 'Printer', 'blockwright-blocks' ),
		'download-simple'    => __( 'Download', 'blockwright-blocks' ),
		'upload-simple'      => __( 'Upload', 'blockwright-blocks' ),
		'magnifying-glass'   => __( 'Search', 'blockwright-blocks' ),
		'bookmark-simple'    => __( 'Bookmark', 'blockwright-blocks' ),
		'bookmark-fill'      => __( 'Bookmark filled', 'blockwright-blocks' ),
		'eye'                => __( 'Eye', 'blockwright-blocks' ),
		'trash'              => __( 'Trash', 'blockwright-blocks' ),
		'copy'               => __( 'Copy', 'blockwright-blocks' ),
		'export'             => __( 'Export', 'blockwright-blocks' ),

		// Business & office.
		'briefcase'          => __( 'Briefcase', 'blockwright-blocks' ),
		'buildings'          => __( 'Buildings', 'blockwright-blocks' ),
		'building-office'    => __( 'Office building', 'blockwright-blocks' ),
		'suitcase'           => __( 'Suitcase', 'blockwright-blocks' ),
		'office-chair'       => __( 'Office chair', 'blockwright-blocks' ),
		'coffee'             => __( 'Coffee', 'blockwright-blocks' ),
		'lightbulb'          => __( 'Lightbulb', 'blockwright-blocks' ),
		'rocket-launch'      => __( 'Rocket', 'blockwright-blocks' ),
		'strategy'           => __( 'Strategy', 'blockwright-blocks' ),
		'megaphone'          => __( 'Megaphone', 'blockwright-blocks' ),
		'newspaper'          => __( 'Newspaper', 'blockwright-blocks' ),
		'graduation-cap'     => __( 'Education', 'blockwright-blocks' ),
		'books'              => __( 'Books', 'blockwright-blocks' ),
		'leaf'               => __( 'Leaf', 'blockwright-blocks' ),
		'recycle'            => __( 'Recycle', 'blockwright-blocks' ),
		'sun'                => __( 'Sun', 'blockwright-blocks' ),
		'moon'               => __( 'Moon', 'blockwright-blocks' ),
		// Health & medical.
		'heartbeat'          => __( 'Heartbeat', 'blockwright-blocks' ),
		'pulse'              => __( 'Pulse', 'blockwright-blocks' ),
		'stethoscope'        => __( 'Stethoscope', 'blockwright-blocks' ),
		'pill'               => __( 'Pill', 'blockwright-blocks' ),
		'first-aid'          => __( 'First aid', 'blockwright-blocks' ),
		'first-aid-kit'      => __( 'First aid kit', 'blockwright-blocks' ),
		'syringe'            => __( 'Syringe', 'blockwright-blocks' ),
		'tooth'              => __( 'Tooth', 'blockwright-blocks' ),
		'brain'              => __( 'Brain', 'blockwright-blocks' ),
		'bandaids'           => __( 'Bandaids', 'blockwright-blocks' ),
		'wheelchair'         => __( 'Wheelchair', 'blockwright-blocks' ),
		'hospital'           => __( 'Hospital', 'blockwright-blocks' ),
		'virus'              => __( 'Virus', 'blockwright-blocks' ),
		'dna'                => __( 'Dna', 'blockwright-blocks' ),
		'thermometer'        => __( 'Thermometer', 'blockwright-blocks' ),
		'prescription'       => __( 'Prescription', 'blockwright-blocks' ),
		'hand-heart'         => __( 'Hand heart', 'blockwright-blocks' ),
		'face-mask'          => __( 'Face mask', 'blockwright-blocks' ),
		// Food & hospitality.
		'fork-knife'         => __( 'Fork knife', 'blockwright-blocks' ),
		'wine'               => __( 'Wine', 'blockwright-blocks' ),
		'beer-stein'         => __( 'Beer stein', 'blockwright-blocks' ),
		'pizza'              => __( 'Pizza', 'blockwright-blocks' ),
		'hamburger'          => __( 'Hamburger', 'blockwright-blocks' ),
		'bread'              => __( 'Bread', 'blockwright-blocks' ),
		'cake'               => __( 'Cake', 'blockwright-blocks' ),
		'chef-hat'           => __( 'Chef hat', 'blockwright-blocks' ),
		'bowl-food'          => __( 'Bowl food', 'blockwright-blocks' ),
		'cooking-pot'        => __( 'Cooking pot', 'blockwright-blocks' ),
		'martini'            => __( 'Martini', 'blockwright-blocks' ),
		'cheese'             => __( 'Cheese', 'blockwright-blocks' ),
		'carrot'             => __( 'Carrot', 'blockwright-blocks' ),
		'cookie'             => __( 'Cookie', 'blockwright-blocks' ),
		'ice-cream'          => __( 'Ice cream', 'blockwright-blocks' ),
		'champagne'          => __( 'Champagne', 'blockwright-blocks' ),
		'coffee-bean'        => __( 'Coffee bean', 'blockwright-blocks' ),
		// Real estate & property.
		'house'              => __( 'House', 'blockwright-blocks' ),
		'house-line'         => __( 'House line', 'blockwright-blocks' ),
		'key'                => __( 'Key', 'blockwright-blocks' ),
		'door'               => __( 'Door', 'blockwright-blocks' ),
		'door-open'          => __( 'Door open', 'blockwright-blocks' ),
		'bed'                => __( 'Bed', 'blockwright-blocks' ),
		'bathtub'            => __( 'Bathtub', 'blockwright-blocks' ),
		'couch'              => __( 'Couch', 'blockwright-blocks' ),
		'blueprint'          => __( 'Blueprint', 'blockwright-blocks' ),
		'ruler'              => __( 'Ruler', 'blockwright-blocks' ),
		'warehouse'          => __( 'Warehouse', 'blockwright-blocks' ),
		'stairs'             => __( 'Stairs', 'blockwright-blocks' ),
		'elevator'           => __( 'Elevator', 'blockwright-blocks' ),
		'keyhole'            => __( 'Keyhole', 'blockwright-blocks' ),
		'garage'             => __( 'Garage', 'blockwright-blocks' ),
		// Education & learning.
		'book-open'          => __( 'Book open', 'blockwright-blocks' ),
		'book-open-text'     => __( 'Book open text', 'blockwright-blocks' ),
		'book-bookmark'      => __( 'Book bookmark', 'blockwright-blocks' ),
		'chalkboard'         => __( 'Chalkboard', 'blockwright-blocks' ),
		'chalkboard-teacher' => __( 'Chalkboard teacher', 'blockwright-blocks' ),
		'student'            => __( 'Student', 'blockwright-blocks' ),
		'backpack'           => __( 'Backpack', 'blockwright-blocks' ),
		'exam'               => __( 'Exam', 'blockwright-blocks' ),
		'notebook'           => __( 'Notebook', 'blockwright-blocks' ),
		'atom'               => __( 'Atom', 'blockwright-blocks' ),
		'calculator'         => __( 'Calculator', 'blockwright-blocks' ),
		'pencil-ruler'       => __( 'Pencil ruler', 'blockwright-blocks' ),
		// Fitness & wellness.
		'barbell'            => __( 'Barbell', 'blockwright-blocks' ),
		'person-simple-run'  => __( 'Person simple run', 'blockwright-blocks' ),
		'person-simple-bike' => __( 'Person simple bike', 'blockwright-blocks' ),
		'person-simple-swim' => __( 'Person simple swim', 'blockwright-blocks' ),
		'person-simple-walk' => __( 'Person simple walk', 'blockwright-blocks' ),
		'person-simple-hike' => __( 'Person simple hike', 'blockwright-blocks' ),
		'bicycle'            => __( 'Bicycle', 'blockwright-blocks' ),
		'basketball'         => __( 'Basketball', 'blockwright-blocks' ),
		'soccer-ball'        => __( 'Soccer ball', 'blockwright-blocks' ),
		'tennis-ball'        => __( 'Tennis ball', 'blockwright-blocks' ),
		'football'           => __( 'Football', 'blockwright-blocks' ),
		'volleyball'         => __( 'Volleyball', 'blockwright-blocks' ),
		'boxing-glove'       => __( 'Boxing glove', 'blockwright-blocks' ),
		'sneaker'            => __( 'Sneaker', 'blockwright-blocks' ),
		'timer'              => __( 'Timer', 'blockwright-blocks' ),
		'swimming-pool'      => __( 'Swimming pool', 'blockwright-blocks' ),
		// Legal & professional.
		'gavel'              => __( 'Gavel', 'blockwright-blocks' ),
		'stamp'              => __( 'Stamp', 'blockwright-blocks' ),
		'signature'          => __( 'Signature', 'blockwright-blocks' ),
		'bank'               => __( 'Bank', 'blockwright-blocks' ),
		'piggy-bank'         => __( 'Piggy bank', 'blockwright-blocks' ),
		'shield'             => __( 'Shield', 'blockwright-blocks' ),
		'shield-star'        => __( 'Shield star', 'blockwright-blocks' ),
		// Travel & local.
		'airplane'           => __( 'Airplane', 'blockwright-blocks' ),
		'airplane-takeoff'   => __( 'Airplane takeoff', 'blockwright-blocks' ),
		'anchor'             => __( 'Anchor', 'blockwright-blocks' ),
		'boat'               => __( 'Boat', 'blockwright-blocks' ),
		'sailboat'           => __( 'Sailboat', 'blockwright-blocks' ),
		'bus'                => __( 'Bus', 'blockwright-blocks' ),
		'car'                => __( 'Car', 'blockwright-blocks' ),
		'taxi'               => __( 'Taxi', 'blockwright-blocks' ),
		'train'              => __( 'Train', 'blockwright-blocks' ),
		'compass'            => __( 'Compass', 'blockwright-blocks' ),
		'camera'             => __( 'Camera', 'blockwright-blocks' ),
		'tent'               => __( 'Tent', 'blockwright-blocks' ),
		'umbrella'           => __( 'Umbrella', 'blockwright-blocks' ),
		'island'             => __( 'Island', 'blockwright-blocks' ),
		'ticket'             => __( 'Ticket', 'blockwright-blocks' ),
		'mountains'          => __( 'Mountains', 'blockwright-blocks' ),
		// Home services & trades.
		'screwdriver'        => __( 'Screwdriver', 'blockwright-blocks' ),
		'toolbox'            => __( 'Toolbox', 'blockwright-blocks' ),
		'paint-brush'        => __( 'Paint brush', 'blockwright-blocks' ),
		'paint-roller'       => __( 'Paint roller', 'blockwright-blocks' ),
		'plugs'              => __( 'Plugs', 'blockwright-blocks' ),
		'ladder'             => __( 'Ladder', 'blockwright-blocks' ),
		'nut'                => __( 'Nut', 'blockwright-blocks' ),
		'pipe'               => __( 'Pipe', 'blockwright-blocks' ),
		'pipe-wrench'        => __( 'Pipe wrench', 'blockwright-blocks' ),
		'broom'              => __( 'Broom', 'blockwright-blocks' ),
		'shovel'             => __( 'Shovel', 'blockwright-blocks' ),
		// Beauty & personal care.
		'sparkle'            => __( 'Sparkle', 'blockwright-blocks' ),
		'flower'             => __( 'Flower', 'blockwright-blocks' ),
		'flower-lotus'       => __( 'Flower lotus', 'blockwright-blocks' ),
		'flower-tulip'       => __( 'Flower tulip', 'blockwright-blocks' ),
		'hair-dryer'         => __( 'Hair dryer', 'blockwright-blocks' ),
		'hand-soap'          => __( 'Hand soap', 'blockwright-blocks' ),
		// Nature & sustainability.
		'tree'               => __( 'Tree', 'blockwright-blocks' ),
		'tree-evergreen'     => __( 'Tree evergreen', 'blockwright-blocks' ),
		'tree-palm'          => __( 'Tree palm', 'blockwright-blocks' ),
		'plant'              => __( 'Plant', 'blockwright-blocks' ),
		'potted-plant'       => __( 'Potted plant', 'blockwright-blocks' ),
		'drop'               => __( 'Drop', 'blockwright-blocks' ),
		'rainbow'            => __( 'Rainbow', 'blockwright-blocks' ),
		'snowflake'          => __( 'Snowflake', 'blockwright-blocks' ),
		'solar-panel'        => __( 'Solar panel', 'blockwright-blocks' ),
		'solar-roof'         => __( 'Solar roof', 'blockwright-blocks' ),
		'wind'               => __( 'Wind', 'blockwright-blocks' ),
		'windmill'           => __( 'Windmill', 'blockwright-blocks' ),
		// Commerce & money (more).
		'basket'             => __( 'Basket', 'blockwright-blocks' ),
		'coins'              => __( 'Coins', 'blockwright-blocks' ),
		'money'              => __( 'Money', 'blockwright-blocks' ),
		'money-wavy'         => __( 'Money wavy', 'blockwright-blocks' ),
		'invoice'            => __( 'Invoice', 'blockwright-blocks' ),
		'qr-code'            => __( 'Qr code', 'blockwright-blocks' ),
		'seal-percent'       => __( 'Seal percent', 'blockwright-blocks' ),
		'shopping-bag-open'  => __( 'Shopping bag open', 'blockwright-blocks' ),
		'tag-simple'         => __( 'Tag simple', 'blockwright-blocks' ),
		// Contact & content (more).
		'phone-call'         => __( 'Phone call', 'blockwright-blocks' ),
		'envelope-open'      => __( 'Envelope open', 'blockwright-blocks' ),
		'chat-text'          => __( 'Chat text', 'blockwright-blocks' ),
		'microphone'         => __( 'Microphone', 'blockwright-blocks' ),
		'music-note'         => __( 'Music note', 'blockwright-blocks' ),
		'play-circle'        => __( 'Play circle', 'blockwright-blocks' ),
		'film-strip'         => __( 'Film strip', 'blockwright-blocks' ),
		'headphones'         => __( 'Headphones', 'blockwright-blocks' ),
		// Technical & data (more).
		'git-commit'         => __( 'Git commit', 'blockwright-blocks' ),
		'git-pull-request'   => __( 'Git pull request', 'blockwright-blocks' ),
		'brackets-curly'     => __( 'Brackets curly', 'blockwright-blocks' ),
		'robot'              => __( 'Robot', 'blockwright-blocks' ),
		'sliders'            => __( 'Sliders', 'blockwright-blocks' ),
		'chart-donut'        => __( 'Chart donut', 'blockwright-blocks' ),
		'chart-scatter'      => __( 'Chart scatter', 'blockwright-blocks' ),
	);
}

add_action(
	'init',
	function () {
		// WP 7.1+ only. Earlier versions keep core's own 88-icon picker untouched.
		if ( ! function_exists( 'wp_register_icon_collection' ) || ! function_exists( 'wp_register_icon' ) ) {
			return;
		}

		$registered = wp_register_icon_collection(
			COLLECTION,
			array(
				'label'       => __( 'Blockwright', 'blockwright-blocks' ),
				'description' => __( 'A curated set of icons for business and agency sites, filling the gaps in the default collection.', 'blockwright-blocks' ),
			)
		);

		if ( ! $registered ) {
			return;
		}

		$dir = BLOCKWRIGHT_BLOCKS_DIR . 'assets/icons/';
		foreach ( icons() as $slug => $label ) {
			$file = $dir . $slug . '.svg';
			if ( ! is_readable( $file ) ) {
				continue;
			}
			wp_register_icon(
				COLLECTION . '/' . $slug,
				array(
					'label'     => $label,
					'file_path' => $file,
				)
			);
		}
	},
	// After core registers its own collections (priority 0 / default 10).
	20
);
