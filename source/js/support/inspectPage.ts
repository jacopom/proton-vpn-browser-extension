import type {RawPageInspection} from './SupportReport';

/**
 * Executed inside the inspected tab via `scripting.executeScript({func})`.
 *
 * The browser serializes this function's source, so it must stay fully
 * self-contained: no imports, no closures, and no syntax that the TypeScript
 * target turns into module-level helpers (async/await, object spread).
 */
export function inspectPage(maxTextLength: number): RawPageInspection {
	const clean = (value: string | null | undefined, max: number) => {
		const text = (value || '').replace(/[ \t\f\v\r]+/g, ' ').trim();

		return text.length > max ? text.slice(0, max) + '…' : text;
	};

	const stripQuery = (url: string) => {
		try {
			const parsed = new URL(url, location.href);

			return parsed.host + parsed.pathname;
		} catch {
			return '';
		}
	};

	const headings: string[] = [];
	document
		.querySelectorAll('h1, h2, h3, [role="alert"], [aria-live="assertive"]')
		.forEach((element) => {
			const text = clean((element as HTMLElement).innerText, 200);

			if (text && headings.length < 15 && headings.indexOf(text) === -1) {
				headings.push(text);
			}
		});

	const frameHosts: string[] = [];
	document.querySelectorAll('iframe[src]').forEach((frame) => {
		const host = stripQuery(frame.getAttribute('src') || '');

		if (host && frameHosts.length < 20 && frameHosts.indexOf(host) === -1) {
			frameHosts.push(host);
		}
	});

	const scriptHosts: string[] = [];
	document.querySelectorAll('script[src]').forEach((script) => {
		const src = stripQuery(script.getAttribute('src') || '');
		const host = src.split('/')[0] || '';

		if (
			host &&
			host !== location.host &&
			scriptHosts.length < 40 &&
			scriptHosts.indexOf(host) === -1
		) {
			scriptHosts.push(host);
		}
	});

	const fullText = (document.body ? document.body.innerText : '')
		.split('\n')
		.map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');

	const navigationEntry = (performance.getEntriesByType('navigation')[0] ||
		undefined) as
		| (PerformanceNavigationTiming & {responseStatus?: number})
		| undefined;

	const refresh = document.querySelector('meta[http-equiv="refresh" i]');

	return {
		title: clean(document.title, 300),
		lang: document.documentElement.lang || '',
		readyState: document.readyState,
		headings,
		text:
			fullText.length > maxTextLength
				? fullText.slice(0, maxTextLength) + '…'
				: fullText,
		textLength: fullText.length,
		frameHosts,
		scriptHosts,
		metaRefresh: refresh
			? clean((refresh.getAttribute('content') || '').split('?')[0], 200)
			: undefined,
		navigation: navigationEntry
			? {
					responseStatus: navigationEntry.responseStatus || undefined,
					nextHopProtocol: navigationEntry.nextHopProtocol || undefined,
					type: navigationEntry.type,
					durationMs: Math.round(navigationEntry.duration),
				}
			: undefined,
	};
}
