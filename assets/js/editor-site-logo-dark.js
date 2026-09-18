/**
 * Extends the core Site Logo block with an optional "Dark mode logo".
 *
 * Adds two attributes (darkLogoId, darkLogoUrl) and a MediaUpload control in
 * the block's Inspector (Site Editor). The front end swaps to the dark image
 * via a <picture> filter in inc/adaptive-logo.php. Plain wp.* globals, no JSX,
 * no build step - matching the theme's minimal asset pipeline.
 */
(function (wp) {
	if (!wp || !wp.hooks || !wp.element || !wp.blockEditor) {
		return;
	}

	const addFilter = wp.hooks.addFilter;
	const el = wp.element.createElement;
	const Fragment = wp.element.Fragment;
	const __ = wp.i18n.__;
	const InspectorControls = wp.blockEditor.InspectorControls;
	const MediaUpload = wp.blockEditor.MediaUpload;
	const MediaUploadCheck = wp.blockEditor.MediaUploadCheck;
	const PanelBody = wp.components.PanelBody;
	const Button = wp.components.Button;
	const createHigherOrderComponent = wp.compose.createHigherOrderComponent;

	const BLOCK = 'core/site-logo';

	// 1. Register the storage attributes on the Site Logo block.
	addFilter(
		'blocks.registerBlockType',
		'blockwright/site-logo-dark-attributes',
		function (settings, name) {
			if (BLOCK !== name) {
				return settings;
			}
			settings.attributes = Object.assign({}, settings.attributes, {
				darkLogoId: { type: 'number' },
				darkLogoUrl: { type: 'string' },
			});
			return settings;
		}
	);

	// 2. Add the "Dark mode logo" media control to the block Inspector.
	const withDarkLogo = createHigherOrderComponent(function (BlockEdit) {
		return function (props) {
			if (BLOCK !== props.name) {
				return el(BlockEdit, props);
			}

			const attributes = props.attributes;
			const setAttributes = props.setAttributes;

			const onSelect = function (media) {
				setAttributes({
					darkLogoId: media.id,
					darkLogoUrl: media.url,
				});
			};

			const onRemove = function () {
				setAttributes({
					darkLogoId: undefined,
					darkLogoUrl: undefined,
				});
			};

			return el(
				Fragment,
				null,
				el(BlockEdit, props),
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{
							title: __('Dark mode logo', 'blockwright-blocks'),
							initialOpen: false,
						},
						el(
							'p',
							{ style: { marginTop: 0 } },
							__(
								'Optional. Shown to visitors whose device is in dark mode. Upload a version of your logo that reads on dark backgrounds. Leave empty to use the main logo in both modes.',
								'blockwright-blocks'
							)
						),
						el(
							MediaUploadCheck,
							null,
							el(MediaUpload, {
								onSelect,
								allowedTypes: ['image'],
								value: attributes.darkLogoId,
								render(o) {
									return el(
										Fragment,
										null,
										el(
											Button,
											{
												variant: 'secondary',
												onClick: o.open,
											},
											attributes.darkLogoUrl
												? __(
														'Replace dark logo',
														'blockwright-blocks'
													)
												: __(
														'Select dark logo',
														'blockwright-blocks'
													)
										),
										attributes.darkLogoUrl
											? el('img', {
													src: attributes.darkLogoUrl,
													alt: '',
													style: {
														display: 'block',
														marginTop: '8px',
														maxWidth: '120px',
														height: 'auto',
													},
												})
											: null,
										attributes.darkLogoUrl
											? el(
													Button,
													{
														variant: 'link',
														isDestructive: true,
														onClick: onRemove,
													},
													__(
														'Remove',
														'blockwright-blocks'
													)
												)
											: null
									);
								},
							})
						)
					)
				)
			);
		};
	}, 'withDarkLogo');

	addFilter(
		'editor.BlockEdit',
		'blockwright/site-logo-dark-control',
		withDarkLogo
	);
})(window.wp);
