/**
 * Extend wp-scripts' default build with one extra entry: the design-system admin
 * screen (build/design-system/index.js). The default entry() still builds every block,
 * so blocks and the admin app build together from `npm run build`. Written as ESM
 * because this package is "type": "module".
 */
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const defaultConfig = require('@wordpress/scripts/config/webpack.config');

export default {
	...defaultConfig,
	entry() {
		const blocks =
			typeof defaultConfig.entry === 'function'
				? defaultConfig.entry()
				: defaultConfig.entry;
		return {
			...blocks,
			'design-system/index': path.resolve(
				process.cwd(),
				'src',
				'design-system',
				'index.js'
			),
		};
	},
};
