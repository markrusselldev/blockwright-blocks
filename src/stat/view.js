/**
 * blockwright/stat - front-end count-up (progressive enhancement).
 *
 * The number is already in the markup as its final value, so with no JS or under
 * prefers-reduced-motion nothing changes. Otherwise, when a stat scrolls into view it
 * counts up from zero once. Vanilla JS, no dependencies.
 */
(function () {
	const els = document.querySelectorAll(
		'.bw-stat__value[data-animate="true"]'
	);
	if (!els.length) {
		return;
	}

	const reduce =
		window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduce || !('IntersectionObserver' in window)) {
		return; // leave the final value in place
	}

	function parse(elm) {
		const raw = elm.getAttribute('data-value') || '';
		const cleaned = raw.replace(/[^0-9.]/g, '');
		const decimals = (cleaned.split('.')[1] || '').length;
		return {
			num: parseFloat(cleaned),
			decimals,
			prefix: elm.getAttribute('data-prefix') || '',
			suffix: elm.getAttribute('data-suffix') || '',
		};
	}

	function format(v, d) {
		const body =
			d.decimals > 0
				? v.toFixed(d.decimals)
				: Math.round(v).toLocaleString();
		return d.prefix + body + d.suffix;
	}

	function run(elm) {
		const d = parse(elm);
		if (isNaN(d.num)) {
			return;
		}
		const duration = 1500;
		let startTime = null;
		function frame(ts) {
			if (!startTime) {
				startTime = ts;
			}
			const p = Math.min((ts - startTime) / duration, 1);
			const eased = 1 - Math.pow(1 - p, 3);
			elm.textContent = format(d.num * eased, d);
			if (p < 1) {
				window.requestAnimationFrame(frame);
			} else {
				elm.textContent = format(d.num, d);
			}
		}
		window.requestAnimationFrame(frame);
	}

	const io = new IntersectionObserver(
		function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					run(entry.target);
					io.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.4 }
	);

	els.forEach(function (elm) {
		const d = parse(elm);
		if (!isNaN(d.num)) {
			elm.textContent = format(0, d); // start from zero so the count-up reads
		}
		io.observe(elm);
	});
})();
