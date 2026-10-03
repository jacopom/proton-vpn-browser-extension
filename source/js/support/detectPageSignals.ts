import {
	type PageSignal,
	PageSignalType,
	type RawPageInspection,
} from './SupportReport';

/**
 * Phrases websites commonly display when they refuse a visitor.
 * Matching is case-insensitive and only English phrases are covered:
 * support still receives the visible text excerpt for other languages.
 */
const textPatterns: [PageSignalType, RegExp][] = [
	[
		PageSignalType.VPN_DETECTED,
		/\b(?:vpn|proxy|proxies|anonymi[sz]er|unblocker|tor exit)\b[^.!?\n]{0,80}?\b(?:detected|detect|blocked|block|not allowed|not permitted|prohibited|not supported|disable|turn off|switch off)\b/i,
	],
	[
		PageSignalType.VPN_DETECTED,
		/\b(?:detected|disable|turn off|switch off|using|use of)\b[^.!?\n]{0,60}?\b(?:a |an |your )?(?:vpn|proxy|anonymi[sz]er|unblocker)\b/i,
	],
	[
		PageSignalType.GEO_BLOCKED,
		/\b(?:not|isn't|unavailable)\b[^.!?\n]{0,60}?\b(?:in|from) your (?:country|region|location|area|territory)\b/i,
	],
	[
		PageSignalType.GEO_BLOCKED,
		/\b(?:geo[- ]?(?:blocked|restricted|restriction)|region[- ]locked|outside (?:of )?(?:the )?(?:us|uk|eu|united states|united kingdom|supported (?:countries|regions)))\b/i,
	],
	[
		PageSignalType.ACCESS_DENIED,
		/\b(?:access denied|access to this page has been denied|forbidden|you(?:'ve| have) been blocked|your (?:ip|ip address|connection|request) (?:has been |was |is )?(?:blocked|banned|flagged)|unusual traffic|suspicious activity|too many requests|rate limit(?:ed)?)\b/i,
	],
	[
		PageSignalType.BOT_CHALLENGE,
		/\b(?:verify (?:that )?you are (?:a )?human|are you a robot|i'm not a robot|checking (?:if the site connection is secure|your browser)|just a moment\.{0,3}|attention required|complete the security check|captcha)\b/i,
	],
	[
		PageSignalType.PAGE_ERROR,
		/\b(?:page not found|this site can(?:'|’)t be reached|took too long to respond|connection (?:timed out|was reset|refused)|bad gateway|service (?:temporarily )?unavailable|internal server error|gateway time-?out|something went wrong|an error (?:has )?occurred|err_[a-z_]+)\b/i,
	],
];

const challengeFrameHosts = [
	/(^|\.)google\.com$/, // matched together with the /recaptcha path upstream
	/(^|\.)recaptcha\.net$/,
	/(^|\.)hcaptcha\.com$/,
	/(^|\.)challenges\.cloudflare\.com$/,
	/(^|\.)arkoselabs\.com$/,
	/(^|\.)funcaptcha\.com$/,
	/(^|\.)geo\.captcha-delivery\.com$/,
];

const excerptRadius = 100;
const maxSignals = 12;

const excerptAround = (text: string, index: number, length: number) => {
	const start = Math.max(0, index - excerptRadius);
	const end = Math.min(text.length, index + length + excerptRadius);

	return (
		(start > 0 ? '…' : '') +
		text.slice(start, end).replace(/\s+/g, ' ').trim() +
		(end < text.length ? '…' : '')
	);
};

const findInText = (
	text: string,
	source: PageSignal['source'],
	signals: PageSignal[],
	seen: Set<string>,
) => {
	textPatterns.forEach(([type, pattern]) => {
		if (signals.length >= maxSignals) {
			return;
		}

		const match = pattern.exec(text);

		if (!match) {
			return;
		}

		// The same message often appears twice (heading or alert, then body text)
		const key = `${type}:${match[0].toLowerCase()}`;

		if (!seen.has(key)) {
			seen.add(key);
			signals.push({
				type,
				source,
				excerpt: excerptAround(text, match.index, match[0].length),
			});
		}
	});
};

/**
 * Look for evidence that the page refuses the connection (VPN detection, geo-blocking,
 * bot challenge, HTTP or browser error) in data read from the page.
 */
export const detectPageSignals = (
	page: Pick<
		RawPageInspection,
		'title' | 'headings' | 'text' | 'frameHosts' | 'navigation'
	>,
): PageSignal[] => {
	const signals: PageSignal[] = [];
	const status = page.navigation?.responseStatus;

	if (status && status >= 400) {
		signals.push({
			type:
				status === 403 || status === 429 || status === 451
					? PageSignalType.ACCESS_DENIED
					: PageSignalType.PAGE_ERROR,
			source: 'http-status',
			excerpt: `HTTP ${status}`,
		});
	}

	const seen = new Set<string>();
	findInText(page.title || '', 'title', signals, seen);
	findInText((page.headings || []).join('\n'), 'text', signals, seen);
	findInText(page.text || '', 'text', signals, seen);

	(page.frameHosts || []).forEach((frame) => {
		const slash = frame.indexOf('/');
		const host = slash < 0 ? frame : frame.slice(0, slash);
		const path = slash < 0 ? '' : frame.slice(slash);

		if (
			challengeFrameHosts.some((pattern) => pattern.test(host)) &&
			(!/google\.com$/.test(host) || path.startsWith('/recaptcha'))
		) {
			signals.push({
				type: PageSignalType.BOT_CHALLENGE,
				source: 'frame',
				excerpt: frame,
			});
		}
	});

	return signals.slice(0, maxSignals);
};
