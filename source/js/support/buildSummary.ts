import {
	PageSignalType,
	type RetryAttempt,
	SupportIssueCategory,
	type SupportReport,
	type TriedAnswer,
} from './SupportReport';

const categoryLabels: Record<SupportIssueCategory, string> = {
	[SupportIssueCategory.VPN_DETECTED]: 'The site detects or blocks the VPN',
	[SupportIssueCategory.SITE_UNREACHABLE]:
		"The site doesn't load or shows an error",
	[SupportIssueCategory.WRONG_LOCATION]:
		'The site shows content for the wrong country',
	[SupportIssueCategory.SLOW]: 'The site is slow',
	[SupportIssueCategory.OTHER]: 'Something else',
};

const signalLabels: Record<PageSignalType, string> = {
	[PageSignalType.VPN_DETECTED]: 'VPN detected',
	[PageSignalType.GEO_BLOCKED]: 'geo-blocked',
	[PageSignalType.ACCESS_DENIED]: 'access denied',
	[PageSignalType.BOT_CHALLENGE]: 'bot challenge',
	[PageSignalType.PAGE_ERROR]: 'error',
	[PageSignalType.VPN_MENTIONED]: 'mentions VPN/proxy',
};

/** Most telling evidence first. */
const signalPriority = [
	PageSignalType.VPN_DETECTED,
	PageSignalType.GEO_BLOCKED,
	PageSignalType.BOT_CHALLENGE,
	PageSignalType.ACCESS_DENIED,
	PageSignalType.PAGE_ERROR,
	PageSignalType.VPN_MENTIONED,
];

const answerLabels: Record<TriedAnswer, string> = {
	'not-tried': 'not tried',
	yes: 'yes',
	no: 'no',
};

/**
 * Country of common IANA time zones, to spot a mismatch between the browser
 * clock and the VPN exit country (a frequent VPN detection signal).
 */
const timeZoneCountries: Record<string, string> = {
	'Europe/Amsterdam': 'NL',
	'Europe/Athens': 'GR',
	'Europe/Belgrade': 'RS',
	'Europe/Berlin': 'DE',
	'Europe/Bratislava': 'SK',
	'Europe/Brussels': 'BE',
	'Europe/Bucharest': 'RO',
	'Europe/Budapest': 'HU',
	'Europe/Copenhagen': 'DK',
	'Europe/Dublin': 'IE',
	'Europe/Helsinki': 'FI',
	'Europe/Istanbul': 'TR',
	'Europe/Kiev': 'UA',
	'Europe/Kyiv': 'UA',
	'Europe/Lisbon': 'PT',
	'Europe/Ljubljana': 'SI',
	'Europe/London': 'GB',
	'Europe/Luxembourg': 'LU',
	'Europe/Madrid': 'ES',
	'Europe/Malta': 'MT',
	'Europe/Moscow': 'RU',
	'Europe/Oslo': 'NO',
	'Europe/Paris': 'FR',
	'Europe/Prague': 'CZ',
	'Europe/Riga': 'LV',
	'Europe/Rome': 'IT',
	'Europe/Sofia': 'BG',
	'Europe/Stockholm': 'SE',
	'Europe/Tallinn': 'EE',
	'Europe/Vienna': 'AT',
	'Europe/Vilnius': 'LT',
	'Europe/Warsaw': 'PL',
	'Europe/Zagreb': 'HR',
	'Europe/Zurich': 'CH',
	'America/New_York': 'US',
	'America/Chicago': 'US',
	'America/Denver': 'US',
	'America/Phoenix': 'US',
	'America/Los_Angeles': 'US',
	'America/Anchorage': 'US',
	'Pacific/Honolulu': 'US',
	'America/Toronto': 'CA',
	'America/Vancouver': 'CA',
	'America/Montreal': 'CA',
	'America/Mexico_City': 'MX',
	'America/Sao_Paulo': 'BR',
	'America/Argentina/Buenos_Aires': 'AR',
	'America/Bogota': 'CO',
	'America/Lima': 'PE',
	'America/Santiago': 'CL',
	'Asia/Tokyo': 'JP',
	'Asia/Seoul': 'KR',
	'Asia/Shanghai': 'CN',
	'Asia/Hong_Kong': 'HK',
	'Asia/Taipei': 'TW',
	'Asia/Singapore': 'SG',
	'Asia/Kolkata': 'IN',
	'Asia/Calcutta': 'IN',
	'Asia/Dubai': 'AE',
	'Asia/Jerusalem': 'IL',
	'Asia/Bangkok': 'TH',
	'Asia/Jakarta': 'ID',
	'Asia/Manila': 'PH',
	'Australia/Sydney': 'AU',
	'Australia/Melbourne': 'AU',
	'Australia/Brisbane': 'AU',
	'Australia/Perth': 'AU',
	'Pacific/Auckland': 'NZ',
	'Africa/Johannesburg': 'ZA',
	'Africa/Cairo': 'EG',
	'Africa/Lagos': 'NG',
	'Africa/Nairobi': 'KE',
};

const quote = (text: string) => `“${text}”`;

const formatOffset = (minutes: number) => {
	const sign = minutes < 0 ? '-' : '+';
	const absolute = Math.abs(minutes);

	return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
};

const countBy = (values: string[]) => {
	const counts: Record<string, number> = {};
	values.forEach((value) => {
		counts[value] = (counts[value] || 0) + 1;
	});

	return Object.entries(counts)
		.sort((a, b) => b[1] - a[1])
		.map(([value, count]) => (count > 1 ? `${count}× ${value}` : value));
};

const describeBrowser = (environment: SupportReport['environment']) => {
	const chrome = /Chrome\/(\d+)/.exec(environment.browser)?.[1];
	const firefox = /Firefox\/(\d+)/.exec(environment.browser)?.[1];
	const subType = environment.browserSubType
		? environment.browserSubType.charAt(0).toUpperCase() +
			environment.browserSubType.slice(1)
		: undefined;
	const engine = firefox
		? `Firefox ${firefox}`
		: chrome
			? `Chrome ${chrome}`
			: 'unknown browser';

	return subType ? `${subType} (${engine})` : engine;
};

const siteLines = (report: SupportReport): string[] => {
	const site = report.site;

	if (!site) {
		return ['No website was open in the current tab.'];
	}

	const lines: string[] = [];
	const document = site.document;
	const mainError = report.networkErrors
		.filter((entry) => entry.type === 'main_frame' && entry.error)
		.pop();
	const redirects = document?.redirects || [];
	const redirectText = redirects.length
		? ` after ${redirects.length} redirect${redirects.length > 1 ? 's' : ''} (${redirects
				.map((hop) => `${hop.statusCode} → ${hop.to}`)
				.join(', ')})`
		: '';

	if (document) {
		lines.push(
			`Site: ${site.url} answered ${document.statusLine?.replace(/^HTTP\/[\d.]+\s*/, 'HTTP ') || `HTTP ${document.statusCode}`}${redirectText}` +
				(document.ip ? `, received from IP ${document.ip}` : '') +
				'.',
		);
	} else if (mainError) {
		lines.push(`Site: ${site.url} failed to load: ${mainError.error}.`);
	} else {
		const status = site.page.navigation?.responseStatus;
		lines.push(
			`Site: ${site.url}${status ? ` answered HTTP ${status}` : ''} (no response details recorded; reloading the page before reporting captures them).`,
		);
	}

	if (site.protection.length) {
		lines.push(
			`Protected by: ${site.protection
				.map(
					(vendor) =>
						`${vendor.vendor} [${vendor.role}; ${vendor.evidence.slice(0, 3).join(', ')}]`,
				)
				.join('; ')}.`,
		);
	}

	if (site.blockReferences.length) {
		lines.push(`Block references: ${site.blockReferences.join('; ')}.`);
	}

	const page = site.page;

	if (page.unavailableReason) {
		lines.push(`Page content could not be read: ${page.unavailableReason}.`);
	}

	const signals = page.signals
		.filter((signal) => signal.source !== 'http-status')
		.sort(
			(a, b) => signalPriority.indexOf(a.type) - signalPriority.indexOf(b.type),
		);

	if (signals.length) {
		signals.slice(0, 4).forEach((signal) => {
			lines.push(
				`Page shows (${signalLabels[signal.type]}): ${signal.excerpt ? quote(signal.excerpt) : `[${signal.source}]`}`,
			);
		});
	} else if (!page.unavailableReason) {
		lines.push(
			`No block or error message recognized on the page${page.lang ? ` (page language: ${page.lang})` : ''}${page.title ? `; title: ${quote(page.title)}` : ''}.`,
		);
	}

	if (site.splitTunneling) {
		lines.push(
			site.splitTunneling.routedThroughVpn
				? `This site goes through the VPN (split tunneling ${site.splitTunneling.mode} mode, ${site.splitTunneling.listed ? 'listed' : 'not listed'}).`
				: `⚠ This site bypasses the VPN because of split tunneling (${site.splitTunneling.mode} mode, ${site.splitTunneling.listed ? 'listed' : 'not listed'}).`,
		);
	}

	return lines;
};

const connectionLines = (report: SupportReport): string[] => {
	const {connection} = report;
	const server = connection.server;
	const details = connection.serverDetails;
	const lines: string[] = [];

	if (server) {
		const city = server.exitCity ? `${server.exitCity}, ` : '';
		const entry =
			server.entryCountry && server.entryCountry !== server.exitCountry
				? `, entry ${server.entryCountry}`
				: '';
		const extra = [
			details?.load !== undefined ? `load ${details.load}%` : undefined,
			details?.tier !== undefined ? `tier ${details.tier}` : undefined,
			details?.features.length
				? `features ${details.features.join('/')}`
				: undefined,
			details?.servicesDownReason
				? `services down: ${details.servicesDownReason}`
				: undefined,
		].filter(Boolean);

		lines.push(
			`VPN: ${connection.state === 'on' ? 'connected to' : `${connection.state}, server`} ${server.name} (${city}${server.exitCountry}${entry}), exit IP ${server.exitIp}, Secure Core ${server.secureCore ? 'on' : 'off'}${extra.length ? `, ${extra.join(', ')}` : ''}.`,
		);
	} else {
		lines.push(
			`VPN: not connected (state: ${connection.state}). The site was visited without the VPN.`,
		);
	}

	if (connection.error) {
		lines.push(
			`VPN error: ${connection.error.message || 'unknown'}${connection.error.code ? ` (code ${connection.error.code})` : ''}.`,
		);
	}

	const proxy = report.browserProxySettings;

	if (proxy?.controlledBy === 'controlled_by_other_extensions') {
		lines.push(
			'⚠ Another extension controls the browser proxy settings: traffic may not go through Proton VPN.',
		);
	} else if (
		server &&
		proxy?.controlledBy &&
		proxy.controlledBy !== 'controlled_by_this_extension'
	) {
		lines.push(
			`⚠ Connected, but the browser proxy is not set by Proton VPN (${proxy.controlledBy}${proxy.value ? `, ${proxy.value}` : ''}).`,
		);
	}
	const webRtc = report.webRtcPolicy;

	if (server && webRtc?.value) {
		lines.push(
			webRtc.value === 'disable_non_proxied_udp'
				? 'WebRTC leak protection is active.'
				: `⚠ WebRTC policy is "${webRtc.value}" (${webRtc.controlledBy}): the real IP can leak to the site through WebRTC.`,
		);
	}

	return lines;
};

const describeRetry = (retry: RetryAttempt) => {
	const location = retry.server
		? [
				[retry.server.exitCity, retry.server.exitCountry]
					.filter(Boolean)
					.join(', '),
				retry.server.exitIp ? `exit IP ${retry.server.exitIp}` : '',
			]
				.filter(Boolean)
				.join(', ')
		: '';
	const where = retry.server
		? `${retry.server.name}${location ? ` (${location})` : ''}`
		: undefined;
	const action =
		retry.kind === 'other-server'
			? `Switched to ${where || 'another server'} and reloaded`
			: where
				? `Reloaded on ${where}`
				: 'Reloaded with the VPN off';

	if (retry.failure) {
		return `${action}: check not completed (${retry.failure}).`;
	}

	const result = [
		retry.error ||
			(retry.statusCode !== undefined ? `HTTP ${retry.statusCode}` : undefined),
		retry.signals
			.filter((signal) => signal !== PageSignalType.VPN_MENTIONED)
			.map((signal) => signalLabels[signal])
			.join(', ') || undefined,
		retry.blockReferences.length ? retry.blockReferences.join(', ') : undefined,
	]
		.filter(Boolean)
		.join(' — ');

	return `${action}: ${retry.blocked ? 'still failing' : 'the page loaded fine'}${result ? ` (${result})` : ''}${retry.blocked && retry.excerpt ? ` ${quote(retry.excerpt)}` : ''}.`;
};

const retryLines = (report: SupportReport): string[] => {
	if (!report.retries.length) {
		return [];
	}

	const otherServers = report.retries.filter(
		(retry) => retry.kind === 'other-server' && !retry.failure,
	);
	const working = otherServers.filter((retry) => !retry.blocked);

	return [
		...(otherServers.length
			? [
					working.length
						? `Retest: the site works on ${working.map((retry) => retry.server?.name).join(', ')} but failed on the original server — likely specific to that server or IP.`
						: `Retest: still failing on ${otherServers.length} other server${otherServers.length > 1 ? 's' : ''} — likely the site blocks the VPN as a whole, not one IP.`,
				]
			: []),
		...report.retries.map(describeRetry),
	];
};

const networkLines = (report: SupportReport): string[] => {
	const errors = report.networkErrors;

	if (!errors.length) {
		return [];
	}

	const kinds = countBy(
		errors.map((entry) =>
			entry.statusCode ? `HTTP ${entry.statusCode}` : entry.error || 'error',
		),
	);
	const lines = [
		`Failed requests on this page: ${errors.length} (${kinds.slice(0, 5).join(', ')}).`,
	];

	if (errors.some((entry) => entry.error?.includes('BLOCKED_BY_CLIENT'))) {
		lines.push(
			'Some requests were blocked inside the browser (ERR_BLOCKED_BY_CLIENT): an ad/tracker blocker or Brave Shields may break the site.',
		);
	}

	return lines;
};

const environmentLines = (report: SupportReport): string[] => {
	const {environment, connection} = report;
	const language = environment.languages[0];
	const lines = [
		`Browser: ${describeBrowser(environment)} on ${environment.platform || 'unknown OS'}, languages ${environment.languages.join(', ') || 'unknown'}, time zone ${environment.timeZone} (${formatOffset(environment.timeZoneOffsetMinutes)}), extension ${environment.extensionVersion}.`,
	];

	const exitCountry = connection.server?.exitCountry?.toUpperCase();
	const timeZoneCountry = timeZoneCountries[environment.timeZone];
	const languageCountry = /^[a-z]{2,3}-([A-Z]{2})$/i
		.exec(language || '')?.[1]
		?.toUpperCase();
	const mismatches = [
		timeZoneCountry && exitCountry && timeZoneCountry !== exitCountry
			? `time zone ${environment.timeZone} (${timeZoneCountry})`
			: undefined,
		languageCountry && exitCountry && languageCountry !== exitCountry
			? `browser language ${language}`
			: undefined,
	].filter(Boolean);

	if (mismatches.length) {
		lines.push(
			`Possible detection signal: ${mismatches.join(' and ')} do${mismatches.length > 1 ? '' : 'es'} not match the VPN exit country ${exitCountry}.`,
		);
	}

	if (report.account?.plan) {
		lines.push(
			`Plan: ${report.account.plan} (max tier ${report.account.maxTier ?? 'unknown'}).`,
		);
	}

	return lines;
};

/** Plain-language findings, most important first, for the support agent reading the report. */
export const buildSummary = (report: SupportReport): string[] => {
	const {issue} = report;

	return [
		`Reported: ${categoryLabels[issue.category]}${issue.description ? ` — ${quote(issue.description)}` : ''}.`,
		`Works with the VPN off: ${answerLabels[issue.worksWithoutVpn]}. Works with another server: ${answerLabels[issue.worksWithOtherServer]}.`,
		...siteLines(report),
		...retryLines(report),
		...connectionLines(report),
		...networkLines(report),
		...environmentLines(report),
		...(report.collectionErrors.length
			? [`Not collected: ${report.collectionErrors.join('; ')}.`]
			: []),
	];
};
