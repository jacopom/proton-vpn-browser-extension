'use popup';
import {getFullAppVersion} from '../config';
import {BackgroundData} from '../messaging/MessageType';
import {sendMessageToBackground} from '../tools/sendMessageToBackground';
import {getInfoFromBackground} from '../tools/getInfoFromBackground';
import {getBrowserSubType} from '../tools/getBrowserSubType';
import {getGlobalBrowser} from '../tools/getGlobalBrowser';
import {timeoutAfter} from '../tools/delay';
import {loadAllFeatures} from '../vpn/features/loadAllFeatures';
import {SplitTunnelingMode} from '../vpn/WebsiteFilter';
import {detectPageSignals} from './detectPageSignals';
import {inspectPage} from './inspectPage';
import {stripUrl} from './stripUrl';
import {redactReport} from './redactReport';
import {
	type PageInspection,
	PageSignalType,
	type RawPageInspection,
	type SupportDiagnostics,
	SupportIssueCategory,
	type SupportReport,
} from './SupportReport';

type Tab = chrome.tabs.Tab;

const maxPageText = 3000;

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}

	// API errors carry their message in `Error`
	const {message, Error: apiMessage} = (error || {}) as {
		message?: string;
		Error?: string;
	};

	if (message || apiMessage) {
		return `${message || apiMessage}`;
	}

	try {
		const json = JSON.stringify(error);

		// Errors lose their fields when passed through extension messaging
		return json && json !== '{}' ? json : 'Unknown error';
	} catch {
		return `${error}`;
	}
};

const isWebPage = (url: string | undefined): url is string =>
	/^(https?|ftp):\/\//i.test(url || '');

/**
 * The tab the user is looking at. When the popup is opened as a page of its own
 * (e.g. detached), fall back to the most recently used tab in another window.
 */
const getInspectedTab = async (): Promise<Tab | undefined> => {
	const tabs = (getGlobalBrowser() as any as typeof chrome).tabs;

	if (!tabs?.query) {
		return undefined;
	}

	const ownPrefix = (getGlobalBrowser() as any as typeof chrome).runtime.getURL(
		'',
	);
	const isOwnPage = (tab: Tab) =>
		(tab.url || tab.pendingUrl || '').startsWith(ownPrefix);

	const [current] = await tabs.query({active: true, currentWindow: true});

	if (current && !isOwnPage(current)) {
		return current;
	}

	return (await tabs.query({active: true}))
		.filter((tab) => !isOwnPage(tab))
		.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
};

const runInspection = async (tabId: number): Promise<RawPageInspection> => {
	const browserApi = getGlobalBrowser() as any as typeof chrome;
	const executeScript = browserApi.scripting?.executeScript;

	if (executeScript) {
		const [result] = await executeScript({
			target: {tabId, frameIds: [0]},
			func: inspectPage,
			args: [maxPageText],
		});

		if (!result?.result) {
			throw new Error('The page did not return any content');
		}

		return result.result as RawPageInspection;
	}

	// Manifest V2 (Firefox): no scripting API
	const [result] = await (browserApi.tabs as any).executeScript(tabId, {
		code: `(${inspectPage.toString()})(${maxPageText})`,
	});

	return result as RawPageInspection;
};

const isBrowserErrorPage = (reason: string | undefined) =>
	/error page/i.test(reason || '');

const inspectTab = async (tab: Tab): Promise<PageInspection> => {
	if (typeof tab.id !== 'number') {
		return {unavailableReason: 'Tab has no identifier', signals: []};
	}

	try {
		const raw = await timeoutAfter(
			runInspection(tab.id),
			3000,
			'Page inspection timed out',
		);

		return {
			title: raw.title,
			lang: raw.lang || undefined,
			readyState: raw.readyState,
			headings: raw.headings,
			textExcerpt: raw.text,
			textLength: raw.textLength,
			frameHosts: raw.frameHosts,
			metaRefresh: raw.metaRefresh,
			navigation: raw.navigation,
			signals: detectPageSignals(raw),
		};
	} catch (error) {
		// Typically "Frame with ID 0 is showing error page" when the browser
		// displays its own error page (DNS failure, connection refused, timeout...)
		const reason = errorMessage(error);

		return {
			unavailableReason: reason,
			title: tab.title,
			signals: isBrowserErrorPage(reason)
				? [
						{
							type: PageSignalType.PAGE_ERROR,
							source: 'title',
							excerpt: 'Browser error page',
						},
					]
				: [],
		};
	}
};

const domainMatches = (hostname: string, domains: string[]) =>
	domains.some((domain) =>
		domain.startsWith('.') ? hostname.endsWith(domain) : hostname === domain,
	);

const getSplitTunnelingStatus = (
	hostname: string,
	splitTunneling: SupportDiagnostics['connection']['splitTunneling'],
) => {
	if (!splitTunneling) {
		return undefined;
	}

	const listed = domainMatches(hostname, splitTunneling.filteredDomains || []);

	return {
		mode: splitTunneling.mode,
		listed,
		routedThroughVpn:
			splitTunneling.mode === SplitTunnelingMode.Include ? listed : !listed,
	};
};

const getSettings = async (): Promise<Record<string, unknown>> => {
	const features = await loadAllFeatures();

	return Object.fromEntries(
		Object.entries(features).map(([name, loaded]) => [name, loaded.config]),
	);
};

const getAccount = async (): Promise<SupportReport['account']> => {
	const user = await getInfoFromBackground('user');

	return {plan: user?.VPN?.PlanName, maxTier: user?.VPN?.MaxTier};
};

const getEnvironment = async (): Promise<SupportReport['environment']> => {
	const nav = navigator as Navigator & {userAgentData?: {platform?: string}};

	return {
		extensionVersion: getFullAppVersion(),
		browser: nav.userAgent,
		browserSubType: await getBrowserSubType().catch(() => undefined),
		platform: nav.userAgentData?.platform || nav.platform || undefined,
		languages: nav.languages,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		timeZoneOffsetMinutes: -new Date().getTimezoneOffset(),
	};
};

/** Guess the most relevant category from what was found on the page. */
export const suggestCategory = (
	report: SupportReport,
): SupportIssueCategory => {
	const signalTypes = (report.site?.page.signals || []).map(
		(signal) => signal.type,
	);

	if (signalTypes.includes(PageSignalType.VPN_DETECTED)) {
		return SupportIssueCategory.VPN_DETECTED;
	}

	if (signalTypes.includes(PageSignalType.GEO_BLOCKED)) {
		return SupportIssueCategory.WRONG_LOCATION;
	}

	if (
		signalTypes.length ||
		report.site?.page.unavailableReason ||
		report.networkErrors.some((entry) => entry.type === 'main_frame')
	) {
		return SupportIssueCategory.SITE_UNREACHABLE;
	}

	return SupportIssueCategory.OTHER;
};

/**
 * Gather everything support needs to debug a website issue: the page as the
 * user sees it, failed requests, the VPN connection, the settings and the
 * environment. Each source is optional: a failure is listed in
 * `collectionErrors` instead of aborting the report.
 */
export const collectSupportReport = async (): Promise<SupportReport> => {
	const collectionErrors: string[] = [];
	const attempt = async <T>(
		label: string,
		promise: Promise<T>,
		timeout = 5000,
	): Promise<T | undefined> => {
		try {
			return await timeoutAfter(promise, timeout, `${label} timed out`);
		} catch (error) {
			collectionErrors.push(`${label}: ${errorMessage(error)}`);

			return undefined;
		}
	};

	const tab = await attempt('Active tab', getInspectedTab());
	const tabUrl = tab?.url || tab?.pendingUrl;
	const webTab = tab && isWebPage(tabUrl) ? tab : undefined;

	const [page, diagnostics, settings, account, environment] = await Promise.all(
		[
			webTab ? inspectTab(webTab) : undefined,
			attempt(
				'Connection diagnostics',
				sendMessageToBackground<SupportDiagnostics>(
					BackgroundData.SUPPORT_DIAGNOSTICS,
					{tabId: webTab?.id},
				),
			),
			attempt('Settings', getSettings()),
			attempt('Account', getAccount()),
			getEnvironment(),
		],
	);

	const hostname = webTab ? new URL(tabUrl as string).hostname : undefined;
	const pageLoadError = diagnostics?.networkErrors
		.filter((entry) => entry.type === 'main_frame' && entry.error)
		.pop()?.error;

	// Name the network error shown on the browser error page (DNS, refused, timeout...)
	if (page && pageLoadError && isBrowserErrorPage(page.unavailableReason)) {
		page.signals.forEach((signal) => {
			if (signal.type === PageSignalType.PAGE_ERROR) {
				signal.excerpt = `Browser error page: ${pageLoadError}`;
			}
		});
	}

	return redactReport({
		version: 1,
		createdAt: new Date().toISOString(),
		issue: {category: SupportIssueCategory.OTHER, description: ''},
		site:
			webTab && page && hostname
				? {
						url: stripUrl(tabUrl as string),
						hostname,
						tabStatus: webTab.status,
						splitTunneling: getSplitTunnelingStatus(
							hostname,
							diagnostics?.connection.splitTunneling,
						),
						page,
					}
				: undefined,
		connection: diagnostics?.connection || {
			state: 'unknown',
			proxyEnabled: false,
		},
		settings: settings || {},
		browserProxySettings: diagnostics?.browserProxySettings,
		webRtcPolicy: diagnostics?.webRtcPolicy,
		networkErrors: diagnostics?.networkErrors || [],
		environment,
		account,
		recentLogs: diagnostics?.recentLogs || [],
		collectionErrors: tab
			? collectionErrors
			: [...collectionErrors, 'No browser tab to inspect'],
	});
};

/** Same report without what the page displays (title, text, headings, excerpts). */
export const withoutPageContent = (report: SupportReport): SupportReport => {
	if (!report.site) {
		return report;
	}

	const {page} = report.site;

	return {
		...report,
		site: {
			...report.site,
			page: {
				unavailableReason: page.unavailableReason,
				readyState: page.readyState,
				lang: page.lang,
				navigation: page.navigation,
				frameHosts: page.frameHosts,
				signals: page.signals.map(({type, source}) => ({type, source})),
			},
		},
	};
};
