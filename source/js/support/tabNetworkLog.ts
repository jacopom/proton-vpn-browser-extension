'use background';
import {Storage, storage} from '../tools/storage';
import {triggerPromise} from '../tools/triggerPromise';
import type {
	DocumentResponse,
	NetworkErrorEntry,
	RedirectHop,
} from './SupportReport';
import {stripUrl} from './stripUrl';

/** Errors kept per tab, the oldest are dropped first. */
const maxErrorsPerTab = 30;
/** Only the most recently active tabs are kept. */
const maxTabs = 20;
const maxRedirects = 10;
const maxHeaderValueLength = 200;

/** Response codes recorded for these request types only, to skip noisy sub-resources (ads, trackers, images). */
const statusRecordedTypes = ['main_frame', 'sub_frame', 'xmlhttprequest'];

/**
 * Response headers worth keeping: they identify the CDN, firewall or anti-bot service,
 * the cache and the request, or tell which country the site thinks the visitor is in.
 * Anything else (cookies, tokens, personal data) is dropped.
 */
const keptHeaders = new Set([
	'server',
	'via',
	'age',
	'content-type',
	'content-language',
	'retry-after',
	'location',
	'vary',
	'x-cache',
	'x-cache-hits',
	'x-served-by',
	'x-cdn',
	'x-iinfo',
	'x-request-id',
	'x-correlation-id',
	'x-amz-cf-id',
	'x-amz-cf-pop',
	'x-amzn-waf-action',
	'x-azure-ref',
	'x-fastly-request-id',
	'akamai-grn',
	'akamai-cache-status',
	'x-akamai-transformed',
	'x-akamai-request-id',
	'x-datadome',
	'x-datadome-cid',
	'x-dd-b',
	'x-sucuri-id',
	'x-sucuri-block',
	'x-sucuri-cache',
	'x-kpsdk-ct',
	'x-kpsdk-cd',
	'x-kpsdk-st',
]);
const keptHeaderPatterns = [/^cf-/, /geo|country|region/];

interface TabNetworkLog {
	/** Request ID of the main document being loaded: redirects keep the same ID. */
	navigationId?: string;
	updated: number;
	errors: NetworkErrorEntry[];
	redirects: RedirectHop[];
	document?: DocumentResponse;
}

type TabLogs = Record<number, TabNetworkLog>;

/** Session storage: kept while the browser runs, so the log survives service worker restarts. */
const storedLogs = storage.item<{value: TabLogs}>(
	'support-tab-network',
	Storage.SESSION,
);

const logs: TabLogs = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Tabs reset while the stored logs were still loading: their stored logs are outdated. */
let resetBeforeLoad: Set<number> | undefined = new Set();
const loading = storedLogs
	.get()
	.then((stored) => {
		Object.entries(stored?.value || {}).forEach(([tabId, log]) => {
			if (!logs[+tabId] && !resetBeforeLoad?.has(+tabId)) {
				logs[+tabId] = log;
			}
		});
	})
	.catch(() => {
		// Nothing stored yet or storage unavailable: start empty
	})
	.finally(() => {
		resetBeforeLoad = undefined;
	});

const scheduleSave = () => {
	if (saveTimer) {
		return;
	}

	saveTimer = setTimeout(() => {
		saveTimer = undefined;
		triggerPromise(storedLogs.set({value: logs}));
	}, 1000);
};

const dropOldestTabs = () => {
	const tabIds = Object.keys(logs).map(Number);

	if (tabIds.length > maxTabs) {
		tabIds
			.sort((a, b) => (logs[a]?.updated || 0) - (logs[b]?.updated || 0))
			.slice(0, tabIds.length - maxTabs)
			.forEach((tabId) => {
				delete logs[tabId];
			});
	}
};

const getLog = (tabId: number): TabNetworkLog => {
	let log = logs[tabId];

	if (!log) {
		log = {updated: Date.now(), errors: [], redirects: []};
		logs[tabId] = log;
		dropOldestTabs();
	}

	log.updated = Date.now();
	scheduleSave();

	return log;
};

const forgetTab = (tabId: number) => {
	resetBeforeLoad?.add(tabId);

	if (logs[tabId]) {
		delete logs[tabId];
		scheduleSave();
	}
};

const truncate = (value: string) =>
	value.length > maxHeaderValueLength
		? value.slice(0, maxHeaderValueLength) + '…'
		: value;

/** Keep allow-listed headers; for cookies, keep only their names. */
export const pickHeaders = (
	responseHeaders: chrome.webRequest.HttpHeader[] | undefined,
) => {
	const headers: Record<string, string> = {};
	const cookieNames = new Set<string>();

	(responseHeaders || []).forEach(({name, value = ''}) => {
		const key = name.toLowerCase();

		if (key === 'set-cookie') {
			// Firefox joins all cookies of the response with new lines
			value.split('\n').forEach((cookie) => {
				const cookieName = cookie.split('=')[0]?.trim();

				if (cookieName) {
					cookieNames.add(cookieName);
				}
			});

			return;
		}

		if (
			keptHeaders.has(key) ||
			keptHeaderPatterns.some((pattern) => pattern.test(key))
		) {
			const kept = key === 'location' ? stripUrl(value) : truncate(value);
			headers[key] = headers[key] ? `${headers[key]}, ${kept}` : kept;
		}
	});

	return {headers, cookieNames: Array.from(cookieNames).slice(0, 40)};
};

const onBeforeNavigation = (
	details: chrome.webRequest.OnBeforeRequestDetails,
) => {
	if (details.tabId < 0) {
		return undefined;
	}

	// A new page starts loading in the tab: what happened on the previous page is no longer relevant.
	// Redirects of the same navigation keep the same request ID and must not reset the log.
	if (logs[details.tabId]?.navigationId !== details.requestId) {
		forgetTab(details.tabId);
		getLog(details.tabId).navigationId = details.requestId;
	}

	return undefined;
};

const onBeforeRedirect = (
	details: chrome.webRequest.OnBeforeRedirectDetails,
) => {
	if (details.tabId < 0) {
		return;
	}

	const log = getLog(details.tabId);
	log.redirects.push({
		from: stripUrl(details.url),
		to: stripUrl(details.redirectUrl),
		statusCode: details.statusCode,
	});
	log.redirects.splice(0, Math.max(0, log.redirects.length - maxRedirects));
};

const onDocumentCompleted = (details: chrome.webRequest.OnCompletedDetails) => {
	if (details.tabId < 0) {
		return;
	}

	const log = getLog(details.tabId);
	log.document = {
		time: Math.round(details.timeStamp),
		url: stripUrl(details.url),
		statusCode: details.statusCode,
		statusLine: details.statusLine,
		ip: details.ip,
		fromCache: details.fromCache || undefined,
		...pickHeaders(details.responseHeaders),
		redirects: log.redirects.slice(),
	};
};

const pushError = (tabId: number, entry: NetworkErrorEntry) => {
	const log = getLog(tabId);
	log.errors.push(entry);
	log.errors.splice(0, Math.max(0, log.errors.length - maxErrorsPerTab));
};

const onErrorOccurred = (details: chrome.webRequest.OnErrorOccurredDetails) => {
	if (details.tabId < 0) {
		return; // Extension's own requests (API calls)
	}

	pushError(details.tabId, {
		time: Math.round(details.timeStamp),
		url: stripUrl(details.url),
		type: details.type,
		method: details.method,
		error: details.error,
		fromCache: details.fromCache || undefined,
		ip: details.ip,
	});
};

const onCompleted = (details: chrome.webRequest.OnCompletedDetails) => {
	if (
		details.tabId < 0 ||
		details.statusCode < 400 ||
		!statusRecordedTypes.includes(details.type)
	) {
		return;
	}

	pushError(details.tabId, {
		time: Math.round(details.timeStamp),
		url: stripUrl(details.url),
		type: details.type,
		method: details.method,
		statusCode: details.statusCode,
		fromCache: details.fromCache || undefined,
		ip: details.ip,
	});
};

/**
 * Remember, per tab, how the main document was received (status, redirects,
 * CDN/firewall headers, cookie names) and which requests failed (net::ERR_*
 * code or HTTP status), so a support report can explain why a site refuses
 * the connection. Nothing leaves the browser unless the user sends a report.
 */
export const initTabNetworkLog = () => {
	const webRequest = (browser as any as typeof chrome).webRequest;

	if (!webRequest) {
		return;
	}

	const allUrls = {urls: ['<all_urls>']};
	const documents = {
		urls: ['<all_urls>'],
		types: ['main_frame' as chrome.webRequest.ResourceType],
	};

	webRequest.onBeforeRequest?.addListener(onBeforeNavigation, documents);
	webRequest.onBeforeRedirect?.addListener(onBeforeRedirect, documents);

	try {
		// Set-Cookie is only exposed with 'extraHeaders' in Chromium
		webRequest.onCompleted?.addListener(onDocumentCompleted, documents, [
			'responseHeaders',
			'extraHeaders',
		]);
	} catch {
		// Firefox does not know 'extraHeaders' and exposes Set-Cookie anyway
		webRequest.onCompleted?.addListener(onDocumentCompleted, documents, [
			'responseHeaders',
		]);
	}

	webRequest.onErrorOccurred?.addListener(onErrorOccurred, allUrls);
	webRequest.onCompleted?.addListener(onCompleted, allUrls);
	(browser as any as typeof chrome).tabs?.onRemoved?.addListener(forgetTab);
};

export const getTabNetworkLog = async (
	tabId: number,
): Promise<{errors: NetworkErrorEntry[]; document?: DocumentResponse}> => {
	await loading;
	const log = logs[tabId];

	return {
		errors: (log?.errors || []).slice(),
		document: log?.document,
	};
};
