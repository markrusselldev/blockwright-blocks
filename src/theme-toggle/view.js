/**
 * blockwright/theme-toggle - front-end behaviour.
 *
 * A binary light / dark override for the visitor. The site is adaptive by default (it follows the
 * OS setting); a click flips it to the opposite of what is showing, and the choice is stored in
 * sessionStorage, so it lasts the browsing session and clears when the tab closes - the OS setting
 * is the source of truth and returns on the next visit. The override is expressed as
 * `color-scheme` plus a `data-bw-scheme` attribute on <html>; the theme's light-dark() tokens
 * follow the former and the button's action icon follows the latter. inc/color-scheme.php sets
 * both in the document head before paint (no flash); this script keeps them in sync and handles
 * clicks. Vanilla JS.
 */
( function () {
	var buttons = document.querySelectorAll( '.bw-theme-toggle' );
	if ( ! buttons.length ) {
		return;
	}

	var KEY = 'bw-color-scheme';
	var root = document.documentElement;

	function stored() {
		try {
			var v = sessionStorage.getItem( KEY );
			return v === 'light' || v === 'dark' ? v : null;
		} catch ( e ) {
			return null;
		}
	}

	function osDark() {
		return !! ( window.matchMedia && window.matchMedia( '(prefers-color-scheme: dark)' ).matches );
	}

	function effective() {
		return stored() || ( osDark() ? 'dark' : 'light' );
	}

	function persist( mode ) {
		try {
			if ( mode === 'light' || mode === 'dark' ) {
				sessionStorage.setItem( KEY, mode );
			} else {
				sessionStorage.removeItem( KEY );
			}
		} catch ( e ) {}
	}

	function apply() {
		var override = stored();
		root.style.colorScheme = override || '';
		if ( override ) {
			root.setAttribute( 'data-bw-scheme', override );
		} else {
			root.removeAttribute( 'data-bw-scheme' );
		}
	}

	function sync() {
		var action = effective() === 'dark' ? 'light' : 'dark';
		var label =
			action === 'dark'
				? 'Switch to the dark colour scheme'
				: 'Switch to the light colour scheme';
		buttons.forEach( function ( btn ) {
			btn.setAttribute( 'aria-label', label );
		} );
	}

	apply();
	sync();

	// When there is no explicit choice, keep the action icon and label in step with the OS.
	if ( window.matchMedia ) {
		try {
			window.matchMedia( '(prefers-color-scheme: dark)' ).addEventListener( 'change', function () {
				if ( ! stored() ) {
					sync();
				}
			} );
		} catch ( e ) {}
	}

	buttons.forEach( function ( btn ) {
		btn.addEventListener( 'click', function () {
			persist( effective() === 'dark' ? 'light' : 'dark' );
			apply();
			sync();
		} );
	} );
} )();
