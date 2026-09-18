/**
 * Dynamic content picker for core Block Bindings.
 *
 * Two halves, both buildless plain JS (wp globals):
 *
 * 1. CLIENT registration of the plugin's two bindings sources (blockwright/post,
 *    blockwright/site) so the editor canvas shows the LIVE resolved value of a
 *    bound block (core only knows the server callback otherwise and would show
 *    the stale stored content). Values are read-only (canUserEditValue false):
 *    this picker binds display fields, it does not write back to them.
 *
 * 2. An always-visible "Dynamic content" inspector panel on the four blocks
 *    core allows bindings on (paragraph, heading, image, button): one labeled
 *    dropdown, a live preview of the resolved value, and the "Static" option
 *    as the one-click disconnect. Writes standard `metadata.bindings` markup,
 *    so a bound block is plain core content with or without this plugin.
 *
 * The PHP side (inc/bindings.php) registers the same sources for front-end
 * rendering. Field lists here and there must stay in sync.
 */
(function (wp) {
	'use strict';

	const el = wp.element.createElement;
	const __ = wp.i18n.__;
	const InspectorControls = wp.blockEditor.InspectorControls;
	const PanelBody = wp.components.PanelBody;
	const SelectControl = wp.components.SelectControl;
	const addFilter = wp.hooks.addFilter;
	const createHigherOrderComponent = wp.compose.createHigherOrderComponent;
	const useSelect = wp.data.useSelect;

	// Which attribute of each bindable block the picker manages (the block's
	// "main" content attribute; core's allowed-blocks list, verified vs 7.0.2).
	const BOUND_ATTR = {
		'core/paragraph': 'content',
		'core/heading': 'content',
		'core/image': 'url',
		'core/button': 'text',
	};

	// field key -> { label, forImage } (forImage: the only field that makes
	// sense bound to an image URL).
	const POST_FIELDS = {
		title: { label: __('Post: Title', 'blockwright-blocks') },
		excerpt: { label: __('Post: Excerpt', 'blockwright-blocks') },
		date: { label: __('Post: Date', 'blockwright-blocks') },
		author: { label: __('Post: Author name', 'blockwright-blocks') },
		'featured-image': {
			label: __('Post: Featured image', 'blockwright-blocks'),
			forImage: true,
		},
	};
	const SITE_FIELDS = {
		title: { label: __('Site: Title', 'blockwright-blocks') },
		tagline: { label: __('Site: Tagline', 'blockwright-blocks') },
		url: { label: __('Site: URL', 'blockwright-blocks') },
	};

	/**
	 * The post used to preview bindings when no post is in context (template /
	 * site editor): the most recent published post.
	 *
	 * @param {Function} select wp.data select.
	 * @return {Object|undefined} A post record, if one has loaded.
	 */
	function previewPost(select) {
		const posts = select('core').getEntityRecords('postType', 'post', {
			per_page: 1,
			status: 'publish',
			orderby: 'date',
			order: 'desc',
			_fields: 'id,title,excerpt,date,author,featured_media',
		});
		return posts && posts.length ? posts[0] : undefined;
	}

	/**
	 * Resolve one field's live value from editor state. Shared by the client
	 * source registrations (canvas rendering) and the panel preview.
	 *
	 * @param {Function} select  wp.data select.
	 * @param {string}   source  Source name (blockwright/post | blockwright/site).
	 * @param {string}   field   Field key.
	 * @param {Object}   context Block context ({ postId, postType }).
	 * @return {string|undefined} The resolved value, if available yet.
	 */
	function resolveField(select, source, field, context) {
		const core = select('core');

		if ('blockwright/site' === source) {
			const site = core.getEntityRecord('root', 'site');
			if (!site) {
				return undefined;
			}
			if ('title' === field) {
				return site.title;
			}
			if ('tagline' === field) {
				return site.description;
			}
			if ('url' === field) {
				return site.url;
			}
			return undefined;
		}

		let record;
		if (context && context.postId) {
			record = core.getEditedEntityRecord(
				'postType',
				context.postType,
				context.postId
			);
		} else {
			// No post in context: the template / site editor. Core leaves bound
			// blocks showing their own stored content here, which reads as "the
			// binding is broken" while you build. Preview with the most recent
			// published post instead, so the block shows the shape of real data.
			// Front-end rendering is unaffected (PHP resolves the actual post).
			record = previewPost(select);
		}
		if (!record || !record.id) {
			return undefined;
		}

		// getEditedEntityRecord returns plain strings; getEntityRecords (the
		// preview post) returns { rendered: '...' } for title/excerpt.
		const text = function (value) {
			if (
				value &&
				'object' === typeof value &&
				undefined !== value.rendered
			) {
				return value.rendered;
			}
			return value;
		};

		switch (field) {
			case 'title':
				return text(record.title);
			case 'excerpt':
				return text(record.excerpt);
			case 'date':
				return record.date
					? wp.date.dateI18n(
							wp.date.getSettings().formats.date,
							record.date
						)
					: undefined;
			case 'author': {
				const user = record.author ? core.getUser(record.author) : null;
				return user ? user.name : undefined;
			}
			case 'featured-image': {
				const media = record.featured_media
					? core.getMedia(record.featured_media)
					: null;
				return media ? media.source_url : undefined;
			}
		}
		return undefined;
	}

	/**
	 * getValues implementation shared by both client sources.
	 *
	 * @param {string} sourceName Registered source name.
	 * @return {Function} getValues callback.
	 */
	function makeGetValues(sourceName) {
		return function (args) {
			const values = {};
			Object.keys(args.bindings).forEach(function (attr) {
				const field =
					args.bindings[attr].args && args.bindings[attr].args.field;
				const value = field
					? resolveField(args.select, sourceName, field, args.context)
					: undefined;
				if (undefined !== value) {
					values[attr] = value;
				}
			});
			return values;
		};
	}

	wp.blocks.registerBlockBindingsSource({
		name: 'blockwright/post',
		label: __('Post (Blockwright)', 'blockwright-blocks'),
		usesContext: ['postId', 'postType'],
		getValues: makeGetValues('blockwright/post'),
		canUserEditValue() {
			return false;
		},
	});

	wp.blocks.registerBlockBindingsSource({
		name: 'blockwright/site',
		label: __('Site (Blockwright)', 'blockwright-blocks'),
		getValues: makeGetValues('blockwright/site'),
		canUserEditValue() {
			return false;
		},
	});

	/**
	 * Dropdown options for a block type. Image binds a URL, so it only offers
	 * URL-shaped fields; the text blocks offer everything except the image URL.
	 *
	 * @param {string} blockName Block type name.
	 * @return {Array} SelectControl options.
	 */
	function optionsFor(blockName) {
		const options = [
			{
				value: '',
				label: __('Static (not connected)', 'blockwright-blocks'),
			},
		];
		const isImage = 'core/image' === blockName;

		Object.keys(POST_FIELDS).forEach(function (field) {
			if (isImage === Boolean(POST_FIELDS[field].forImage)) {
				options.push({
					value: 'blockwright/post|' + field,
					label: POST_FIELDS[field].label,
				});
			}
		});
		if (!isImage) {
			Object.keys(SITE_FIELDS).forEach(function (field) {
				options.push({
					value: 'blockwright/site|' + field,
					label: SITE_FIELDS[field].label,
				});
			});
		}
		return options;
	}

	/**
	 * The picker panel, injected under Inspector settings for bindable blocks.
	 */
	const withDynamicContentPanel = createHigherOrderComponent(function (
		BlockEdit
	) {
		return function (props) {
			const attr = BOUND_ATTR[props.name];
			if (!attr || !props.isSelected) {
				return el(BlockEdit, props);
			}

			const metadata = props.attributes.metadata || {};
			const bindings = metadata.bindings || {};
			const current = bindings[attr];
			const currentValue =
				current && current.source && current.args && current.args.field
					? current.source + '|' + current.args.field
					: '';
			// Only manage our own sources; if another source owns the binding
			// (e.g. core/post-meta via the core UI), leave it alone.
			const foreign =
				current && 0 !== currentValue.indexOf('blockwright/');

			const preview = useSelect(
				function (select) {
					if (!currentValue || foreign) {
						return undefined;
					}
					return resolveField(
						select,
						current.source,
						current.args.field,
						props.context
					);
				},
				// eslint-disable-next-line react-hooks/exhaustive-deps -- deps intentionally curated; resolveField reads the live `select` each call.
				[currentValue, foreign, props.context && props.context.postId]
			);

			const onChange = function (next) {
				const newBindings = Object.assign({}, bindings);
				if (next) {
					const parts = next.split('|');
					newBindings[attr] = {
						source: parts[0],
						args: { field: parts[1] },
					};
				} else {
					delete newBindings[attr];
				}
				const newMetadata = Object.assign({}, metadata, {
					bindings: newBindings,
				});
				if (!Object.keys(newBindings).length) {
					delete newMetadata.bindings;
				}
				props.setAttributes({
					metadata: Object.keys(newMetadata).length
						? newMetadata
						: undefined,
				});
			};

			let help;
			if (foreign) {
				help = __(
					'Connected through another source; manage it in the Attributes panel.',
					'blockwright-blocks'
				);
			} else if (
				currentValue &&
				0 === currentValue.indexOf('blockwright/post') &&
				!(props.context && props.context.postId)
			) {
				// Only non-obvious state: the canvas is showing a SAMPLE post, not
				// this one. Core's convention is to state the connection state, not
				// echo the value (the canvas already shows it) - e.g. core's own
				// "Connected to dynamic data".
				help = __(
					'Previewing with your latest post.',
					'blockwright-blocks'
				);
			} else if (currentValue && undefined === preview) {
				help = __(
					'No value here yet (it fills in on a real post).',
					'blockwright-blocks'
				);
			} else if (!currentValue) {
				help = __(
					'Fill this block from post or site data instead of typed content.',
					'blockwright-blocks'
				);
			}

			return el(
				wp.element.Fragment,
				null,
				el(BlockEdit, props),
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{
							title: __('Dynamic content', 'blockwright-blocks'),
							initialOpen: true,
						},
						el(SelectControl, {
							label: __('Content source', 'blockwright-blocks'),
							value: foreign ? '' : currentValue,
							options: optionsFor(props.name),
							onChange,
							disabled: Boolean(foreign),
							help,
							__nextHasNoMarginBottom: true,
						})
					)
				)
			);
		};
	}, 'withDynamicContentPanel');

	addFilter(
		'editor.BlockEdit',
		'blockwright/dynamic-content-panel',
		withDynamicContentPanel
	);
})(window.wp);
