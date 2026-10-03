'use popup';
import {getGlobalBrowser} from '../tools/getGlobalBrowser';
import {getInfoFromBackground} from '../tools/getInfoFromBackground';
import {delay} from '../tools/delay';
import {collectSupportReport} from './collectSupportReport';
import {
	PageSignalType,
	type RetryAttempt,
	type SupportReport,
} from './SupportReport';

const connectionTimeout = 20000;
const loadTimeout = 30000;
/** Let late scripts (challenges, consent banners, error messages) render after "complete". */
const settleDelay = 1500;

const blockingSignals = [
	PageSignalType.VPN_DETECTED,
	PageSignalType.GEO_BLOCKED,
	PageSignalType.ACCESS_DENIED,
	PageSignalType.BOT_CHALLENGE,
	PageSignalType.PAGE_ERROR,
];

const tabsApi = () => (getGlobalBrowser() as any as typeof chrome).tabs;

/** Wait until the background reports a connection to the given server. */
export const waitForServer = async (logicalId: string | number) => {
	const deadline = Date.now() + connectionTimeout;
	let lastError: string | undefined;

	while (Date.now() < deadline) {
		const state = await getInfoFromBackground('state').catch(() => undefined);
		const error = state?.error as
			| {message?: string; Error?: string}
			| undefined;
		lastError = error ? error.Error || error.message : undefined;

		if (
			state?.server &&
			String(state.server.id) === String(logicalId) &&
			!state.starting
		) {
			return;
		}

		await delay(400);
	}

	throw new Error(lastError || 'The new server did not connect in time');
};

/** Reload the tab, bypassing the cache, and wait until the page finished loading. */
export const reloadTab = (tabId: number) =>
	new Promise<void>((resolve, reject) => {
		const tabs = tabsApi();
		let started = false;
		const timeout = setTimeout(() => {
			cleanUp();
			// Report what the page shows now, even if it never finished loading
			resolve();
		}, loadTimeout);
		const cleanUp = () => {
			clearTimeout(timeout);
			tabs.onUpdated.removeListener(onUpdated);
			tabs.onRemoved.removeListener(onRemoved);
		};
		const onUpdated = (
			updatedTabId: number,
			change: chrome.tabs.OnUpdatedInfo,
		) => {
			if (updatedTabId !== tabId) {
				return;
			}

			if (change.status === 'loading') {
				started = true;
			}

			if (started && change.status === 'complete') {
				cleanUp();
				resolve();
			}
		};
		const onRemoved = (removedTabId: number) => {
			if (removedTabId === tabId) {
				cleanUp();
				reject(new Error('The tab was closed'));
			}
		};

		tabs.onUpdated.addListener(onUpdated);
		tabs.onRemoved.addListener(onRemoved);
		Promise.resolve(tabs.reload(tabId, {bypassCache: true})).catch(
			(error: unknown) => {
				cleanUp();
				reject(error);
			},
		);
	}).then(() => delay(settleDelay));

/** Reduce a fresh snapshot of the page to what changed for support: did it work this time? */
export const summarizeAttempt = (
	snapshot: SupportReport,
	kind: RetryAttempt['kind'],
): RetryAttempt => {
	const site = snapshot.site;
	const server = snapshot.connection.server;
	const mainError = snapshot.networkErrors
		.filter((entry) => entry.type === 'main_frame' && entry.error)
		.pop()?.error;
	const statusCode =
		site?.document?.statusCode ?? site?.page.navigation?.responseStatus;
	const signals = site?.page.signals || [];
	const blockingSignal = signals.find((signal) =>
		blockingSignals.includes(signal.type),
	);

	return {
		time: Date.now(),
		kind,
		server: server && {
			id: server.id,
			name: server.name,
			exitCountry: server.exitCountry,
			exitCity: server.exitCity,
			exitIp: server.exitIp,
		},
		statusCode,
		error: mainError,
		signals: Array.from(new Set(signals.map((signal) => signal.type))),
		excerpt: blockingSignal?.excerpt,
		protection: (site?.protection || []).map((vendor) => vendor.vendor),
		blockReferences: site?.blockReferences || [],
		blocked:
			!site ||
			!!mainError ||
			!!site.page.unavailableReason ||
			(statusCode !== undefined && statusCode >= 400) ||
			!!blockingSignal,
	};
};

/** Reload the reported tab and check it again (on the current server). */
export const recheckSite = async (
	tabId: number,
	kind: RetryAttempt['kind'],
): Promise<RetryAttempt> => {
	await reloadTab(tabId);
	const snapshot = await collectSupportReport({tabId, screenshot: false});

	return summarizeAttempt(snapshot, kind);
};
