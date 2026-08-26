# About this repository

This is a **read-only mirror** of the Blockwright Blocks plugin, published here for reference
and so the source can be read, built, and forked. Development happens in a private canonical
repository, and this mirror is published from it.

**This repository does not take code contributions, and its Issues tab is off.** Pull requests
opened here are not merged.

**For bug reports, questions, and support, use the WordPress.org support forum:**
https://wordpress.org/support/plugin/blockwright-blocks/

That is the single place support is handled, so nothing falls through the cracks.

## Building

Requires Node 18 or newer.

```
npm install
npm run build     # compile the blocks in src/ to build/ with @wordpress/scripts
npm run start     # the same compile in watch mode, for development
```

The blocks are authored under `src/<slug>/` and compiled to `build/<slug>/`. The compiled
`build/` is intentionally not committed; run `npm run build` after cloning so WordPress can
register the blocks.

## License

GPL-2.0-or-later.
