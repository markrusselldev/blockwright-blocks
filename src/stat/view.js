/**
 * blockwright/stat - front-end count-up (progressive enhancement).
 *
 * The number is already in the markup as its final value, so with no JS or under
 * prefers-reduced-motion nothing changes. Otherwise, when a stat scrolls into view it
 * counts up from zero once. Vanilla JS, no dependencies.
 */
( function () {
	var els = document.querySelectorAll( '.bw-stat__value[data-animate="true"]' );
	if ( ! els.length ) {
		return;
	}

	var reduce =
		window.matchMedia &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	if ( reduce || ! ( 'IntersectionObserver' in window ) ) {
		return; // leave the final value in place
	}

	function parse( elm ) {
		var raw = elm.getAttribute( 'data-value' ) || '';
		var cleaned = raw.replace( /[^0-9.]/g, '' );
		var decimals = ( cleaned.split( '.' )[ 1 ] || '' ).length;
		return {
			num: parseFloat( cleaned ),
			decimals: decimals,
			prefix: elm.getAttribute( 'data-prefix' ) || '',
			suffix: elm.getAttribute( 'data-suffix' ) || '',
		};
	}

	function format( v, d ) {
		var body =
			d.decimals > 0
				? v.toFixed( d.decimals )
				: Math.round( v ).toLocaleString();
		return d.prefix + body + d.suffix;
	}

	function run( elm ) {
		var d = parse( elm );
		if ( isNaN( d.num ) ) {
			return;
		}
		var duration = 1500;
		var startTime = null;
		function frame( ts ) {
			if ( ! startTime ) {
				startTime = ts;
			}
			var p = Math.min( ( ts - startTime ) / duration, 1 );
			var eased = 1 - Math.pow( 1 - p, 3 );
			elm.textContent = format( d.num * eased, d );
			if ( p < 1 ) {
				window.requestAnimationFrame( frame );
			} else {
				elm.textContent = format( d.num, d );
			}
		}
		window.requestAnimationFrame( frame );
	}

	var io = new IntersectionObserver(
		function ( entries ) {
			entries.forEach( function ( entry ) {
				if ( entry.isIntersecting ) {
					run( entry.target );
					io.unobserve( entry.target );
				}
			} );
		},
		{ threshold: 0.4 }
	);

	els.forEach( function ( elm ) {
		var d = parse( elm );
		if ( ! isNaN( d.num ) ) {
			elm.textContent = format( 0, d ); // start from zero so the count-up reads
		}
		io.observe( elm );
	} );
} )();
