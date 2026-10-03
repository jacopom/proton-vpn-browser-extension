import {
	type PageSignal,
	PageSignalType,
	type RawPageInspection,
} from './SupportReport';

/**
 * Build a case-insensitive pattern matching one of the alternatives as whole words.
 * `\b` only knows ASCII letters, so word edges are checked with Unicode letter classes
 * to support accented languages ("détecté", "verfügbar"...).
 */
const words = (...alternatives: string[]) =>
	new RegExp(
		`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
		'iu',
	);

/** Two groups of words close to each other (same sentence, within `distance` characters). */
const near = (first: string[], second: string[], distance: number) =>
	words(
		`(?:${first.join('|')})[^.!?\\n]{0,${distance}}?(?:${second.join('|')})`,
	);

const vpnWords = [
	'vpns?',
	'proxy',
	'prox(?:y|ies)',
	'anonymi[sz]ers?',
	'unblockers?',
	'tor exit',
	'tor network',
];

const detectionWords = [
	// English
	'detected',
	'detect',
	'blocked',
	'block',
	'not allowed',
	'not permitted',
	'prohibited',
	'not supported',
	'disable',
	'turn off',
	'switch off',
	'deactivate',
	// Italian
	'rilevat[oaie]',
	'bloccat[oaie]',
	'disattiva(?:re|lo|la|te)?',
	"non (?:è|e') consentit[oa]",
	'non consentit[oa]',
	'vietat[oa]',
	'spegn(?:i|ere)',
	// French
	'détecté(?:e|s)?',
	'detecte(?:e|s)?',
	'bloqué(?:e|s)?',
	'désactive[rz]?',
	'non autorisé(?:e|s)?',
	'interdit(?:e|s)?',
	// German
	'erkannt',
	'blockiert',
	'gesperrt',
	'deaktivier(?:en|e|t)',
	'nicht erlaubt',
	'nicht gestattet',
	'ausschalten',
	'abschalten',
	// Spanish / Portuguese
	'detectad[oa]s?',
	'detetad[oa]s?',
	'bloquead[oa]s?',
	'desactiva(?:r|lo|la)?',
	'desativ(?:e|ar)',
	'no (?:está )?permitid[oa]',
	'não (?:é )?permitid[oa]',
	'prohibid[oa]',
	'proibid[oa]',
	// Dutch
	'gedetecteerd',
	'geblokkeerd',
	'uitschakelen',
	'niet toegestaan',
];

const usageWords = [
	'using',
	'use of',
	'you use',
	'utilizz\\p{L}*',
	'usando',
	'utilis\\p{L}*',
	'verwende\\p{L}*',
	'nutz\\p{L}*',
	'gebruik\\p{L}*',
];

/**
 * Phrases websites display when they refuse a visitor, in English, Italian,
 * French, German, Spanish, Portuguese and Dutch.
 */
const textPatterns: [PageSignalType, RegExp][] = [
	[PageSignalType.VPN_DETECTED, near(vpnWords, detectionWords, 80)],
	[
		PageSignalType.VPN_DETECTED,
		near([...detectionWords, ...usageWords], vpnWords, 60),
	],
	[
		PageSignalType.GEO_BLOCKED,
		near(
			['not', "isn't", 'unavailable'],
			['(?:in|from) your (?:country|region|location|area|territory)'],
			60,
		),
	],
	[
		PageSignalType.GEO_BLOCKED,
		words(
			'geo[- ]?(?:blocked|restricted|restriction)',
			'region[- ]locked',
			// Italian
			"non (?:è |e' )?disponibile (?:nel tuo paese|nella tua (?:regione|area|zona)|dal tuo paese)",
			'non disponibile in italia',
			// French
			'(?:pas|non) disponible (?:dans votre (?:pays|région)|depuis votre (?:pays|région))',
			// German
			'in (?:deinem|ihrem) (?:land|region) nicht verfügbar',
			'nicht in (?:deinem|ihrem) land verfügbar',
			// Spanish / Portuguese
			'no (?:está )?disponible en (?:tu|su) (?:país|región|ubicación)',
			'(?:não (?:está )?disponível|indisponível) (?:no seu país|na sua região)',
			// Dutch
			'niet beschikbaar in (?:jouw|uw) (?:land|regio)',
		),
	],
	[
		PageSignalType.ACCESS_DENIED,
		words(
			'access denied',
			'access to this page has been denied',
			'forbidden',
			"you(?:'ve| have) been blocked",
			'your (?:ip|ip address|connection|request) (?:has been |was |is )?(?:blocked|banned|flagged)',
			'unusual traffic',
			'suspicious activity',
			'too many requests',
			'rate limit(?:ed)?',
			'request (?:was )?rejected',
			'the requested url was rejected',
			// Italian
			'accesso negato',
			'accesso non (?:consentito|autorizzato)',
			'(?:sei|siete) stat[oi] bloccat[oi]',
			'richiesta (?:è stata )?bloccata',
			'traffico (?:insolito|anomalo|sospetto)',
			'troppe richieste',
			// French
			'accès (?:refusé|interdit)',
			'vous avez été bloqué(?:e)?',
			'trafic inhabituel',
			'trop de requêtes',
			// German
			'zugriff verweigert',
			'zugang verweigert',
			'sie wurden blockiert',
			'ungewöhnlicher datenverkehr',
			'zu viele anfragen',
			// Spanish / Portuguese
			'acceso denegado',
			'has sido bloquead[oa]',
			'tráfico inusual',
			'demasiadas solicitudes',
			'acesso negado',
			'tráfego incomum',
			// Dutch
			'toegang geweigerd',
		),
	],
	[
		PageSignalType.BOT_CHALLENGE,
		words(
			'verify (?:that )?you are (?:a )?human',
			'are you a robot',
			"i'm not a robot",
			'checking (?:if the site connection is secure|your browser)',
			'just a moment',
			'attention required',
			'complete the security check',
			'press (?:&|and) hold',
			'captcha',
			// Italian
			'non sono un robot',
			'verifica (?:di essere|che sei) (?:un )?(?:umano|una persona)',
			'premi e tieni premuto',
			'controllo di sicurezza',
			// French
			'je ne suis pas un robot',
			'vérifi\\p{L}* que vous êtes (?:un )?humain',
			'appuyez (?:et|puis) maintenez',
			'vérification de sécurité',
			// German
			'ich bin kein roboter',
			'bestätigen sie, dass sie ein mensch sind',
			'drücken und halten',
			'sicherheitsüberprüfung',
			// Spanish / Portuguese
			'no soy un robot',
			'verifica que eres (?:un )?humano',
			'mantén presionado',
			'comprobación de seguridad',
			'não sou um robô',
		),
	],
	[
		PageSignalType.PAGE_ERROR,
		words(
			'page not found',
			"this site can(?:'|’)t be reached",
			'took too long to respond',
			'connection (?:timed out|was reset|refused)',
			'bad gateway',
			'service (?:temporarily )?unavailable',
			'internal server error',
			'gateway time-?out',
			'something went wrong',
			'an error (?:has )?occurred',
			'err_[a-z_]+',
			// Italian
			'pagina non trovata',
			'si è verificato un errore',
			'servizio (?:temporaneamente )?non disponibile',
			'qualcosa è andato storto',
			// French
			'page introuvable',
			"une erreur (?:s'est produite|est survenue)",
			'service (?:temporairement )?indisponible',
			// German
			'seite nicht gefunden',
			'ein fehler ist aufgetreten',
			'dienst nicht verfügbar',
			// Spanish / Portuguese
			'página no encontrada',
			'se ha producido un error',
			'servicio no disponible',
			'algo salió mal',
			'página não encontrada',
			'ocorreu um erro',
		),
	],
];

/** Fallback: any mention of VPN/proxy, reported only when nothing more precise was found. */
const vpnMention = words(...vpnWords);

const challengeFrameHosts = [
	/(^|\.)google\.com$/, // matched together with the /recaptcha path below
	/(^|\.)recaptcha\.net$/,
	/(^|\.)hcaptcha\.com$/,
	/(^|\.)challenges\.cloudflare\.com$/,
	/(^|\.)arkoselabs\.com$/,
	/(^|\.)funcaptcha\.com$/,
	/(^|\.)captcha-delivery\.com$/,
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
	// Body text first: its excerpts carry more context than the title
	findInText((page.headings || []).join('\n'), 'text', signals, seen);
	findInText(page.text || '', 'text', signals, seen);
	findInText(page.title || '', 'title', signals, seen);

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

	if (!signals.some((signal) => signal.type === PageSignalType.VPN_DETECTED)) {
		const text = page.text || '';
		const mention = vpnMention.exec(text);

		if (mention) {
			signals.push({
				type: PageSignalType.VPN_MENTIONED,
				source: 'text',
				excerpt: excerptAround(text, mention.index, mention[0].length),
			});
		}
	}

	return signals.slice(0, maxSignals);
};
