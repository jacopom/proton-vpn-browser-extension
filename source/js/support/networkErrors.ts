'use background';
import {Storage, storage} from '../tools/storage';
import {triggerPromise} from '../tools/triggerPromise';
import type {NetworkErrorEntry} from './SupportReport';
import {stripUrl} from './stripUrl';

/** Errors kept per tab, the oldest are dropped first. */
const maxEntriesPerTab = 30;
/** Only the most recently active tabs are kept. */
const maxTabs = 20;

/** Response codes recorded for these request types only, to skip noisy sub-resources (ads, trackers, images). */
const statusRecordedTypes = ['main_frame', 'sub_frame', 'xmlhttprequest'];

type TabErrors = Record<number, NetworkErrorEntry[]>;

/** Session storage: kept while the browser runs, so errors survive service worker restarts. */
const storedErrors = storage.item<{value: TabErrors}>(
	'support-network-errors',
	Storage.SESSION,
);

let errorsByTab: TabErrors = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Tabs reset while the stored errors were still loading: their stored errors are outdated. */
let resetBeforeLoad: Set<number> | undefined = new Set();
const loading = storedErrors
	.get()
	.then((stored) => {
		Object.entries(stored?.value || {}).forEach(([tabId, entries]) => {
			if (!errorsByTab[+tabId] && !resetBeforeLoad?.has(+tabId)) {
				errorsByTab[+tabId] = entries;
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
		triggerPromise(storedErrors.set({value: errorsByTab}));
	}, 1000);
};

const push = (tabId: number, entry: NetworkErrorEntry) => {
	const list = errorsByTab[tabId] || [];
	list.push(entry);
	list.splice(0, Math.max(0, list.length - maxEntriesPerTab));
	errorsByTab[tabId] = list;

	const tabIds = Object.keys(errorsByTab);

	if (tabIds.length > maxTabs) {
		tabIds
			.map(Number)
			.sort(
				(a, b) =>
					(errorsByTab[a]?.slice(-1)[0]?.time || 0) -
					(errorsByTab[b]?.slice(-1)[0]?.time || 0),
			)
			.slice(0, tabIds.length - maxTabs)
			.forEach((oldTabId) => {
				delete errorsByTab[oldTabId];
			});
	}

	scheduleSave();
};

const forgetTab = (tabId: number) => {
	resetBeforeLoad?.add(tabId);

	if (errorsByTab[tabId]) {
		delete errorsByTab[tabId];
		scheduleSave();
	}
};

const onBeforeNavigation = (
	details: chrome.webRequest.OnBeforeRequestDetails,
) => {
	// A new page starts loading in the tab: errors of the previous page are no longer relevant
	if (details.tabId >= 0 && details.type === 'main_frame') {
		forgetTab(details.tabId);
	}

	return undefined;
};

const onErrorOccurred = (details: chrome.webRequest.OnErrorOccurredDetails) => {
	if (details.tabId < 0) {
		return; // Extension's own requests (API calls)
	}

	push(details.tabId, {
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

	push(details.tabId, {
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
 * Remember recent failed requests per tab, so a support report can tell which
 * requests of the visited site failed and how (net::ERR_* code or HTTP status).
 * Nothing leaves the browser unless the user sends a support report.
 */
export const initNetworkErrorRecorder = () => {
	const webRequest = (browser as any as typeof chrome).webRequest;

	if (!webRequest) {
		return;
	}

	const allUrls = {urls: ['<all_urls>']};

	webRequest.onBeforeRequest?.addListener(onBeforeNavigation, {
		urls: ['<all_urls>'],
		types: ['main_frame'],
	});
	webRequest.onErrorOccurred?.addListener(onErrorOccurred, allUrls);
	webRequest.onCompleted?.addListener(onCompleted, allUrls);
	(browser as any as typeof chrome).tabs?.onRemoved?.addListener(forgetTab);
};

export const getTabNetworkErrors = async (
	tabId: number,
): Promise<NetworkErrorEntry[]> => {
	await loading;

	return (errorsByTab[tabId] || []).slice();
};
