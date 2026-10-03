'use background';
import {getCurrentState} from '../state';
import {getRecords} from '../log/record';
import {timeoutAfter} from '../tools/delay';
import {getTabNetworkLog} from './tabNetworkLog';
import type {SettingStatus, SupportDiagnostics} from './SupportReport';

const maxLogs = 40;
const maxLogLineLength = 400;

const readSetting = (
	setting:
		| {get(details: object, callback: (details: any) => void): void}
		| undefined,
	pickValue: (value: any) => unknown,
): Promise<SettingStatus | undefined> =>
	setting
		? timeoutAfter(
				new Promise<SettingStatus>((resolve) => {
					setting.get({}, (details) => {
						resolve({
							controlledBy: details?.levelOfControl,
							value: pickValue(details?.value),
						});
					});
				}),
				2000,
			).catch(() => undefined)
		: Promise.resolve(undefined);

const describe = (value: unknown): string => {
	if (typeof value === 'string') {
		return value;
	}

	if (value instanceof Error) {
		return `${value.name}: ${value.message}`;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return `${value}`;
	}
};

/**
 * Turn a log record (`[timestamp, [level, ...params]]`, possibly nested once more
 * when it comes from the popup) into a single readable line.
 */
export const formatLogRecord = (entry: unknown): string => {
	if (!Array.isArray(entry)) {
		return describe(entry).slice(0, maxLogLineLength);
	}

	const [time, ...rest] = entry;
	let params: unknown[] = rest;

	while (params.length === 1 && Array.isArray(params[0])) {
		params = params[0] as unknown[];
	}

	const date = typeof time === 'number' ? new Date(time) : undefined;
	const line = [
		date && !isNaN(date.getTime()) ? date.toISOString() : `${time}`,
		...params.map(describe),
	].join(' ');

	return line.length > maxLogLineLength
		? line.slice(0, maxLogLineLength) + '…'
		: line;
};

/**
 * Collect what only the background knows for a support report. Built from an
 * allow-list: connection credentials and session tokens are never included.
 */
export const getSupportDiagnostics = async (
	tabId: number | undefined,
): Promise<SupportDiagnostics> => {
	const state = getCurrentState();
	const {server, error} = state.data;
	const chromeApi = browser as any as typeof chrome;

	const [browserProxySettings, webRtcPolicy, networkLog] = await Promise.all([
		// Only the mode: the PAC script itself holds the server list
		readSetting(chromeApi.proxy?.settings, (value) => value?.mode),
		readSetting(
			chromeApi.privacy?.network?.webRTCIPHandlingPolicy,
			(value) => value,
		),
		typeof tabId === 'number' ? getTabNetworkLog(tabId) : undefined,
	]);

	return {
		connection: {
			state: state.name,
			proxyEnabled: !!state.proxyEnabled,
			since: state.initializedAt || undefined,
			server: server
				? {
						id: server.id,
						name: server.name,
						entryCountry: server.entryCountry,
						exitCountry: server.exitCountry,
						exitCity: server.exitEnglishCity || server.exitCity,
						exitIp: server.exitIp,
						secureCore: server.secureCore,
						proxyHost: server.proxyHost,
						proxyPort: server.proxyPort,
					}
				: undefined,
			splitTunneling: server?.splitTunneling
				? {
						mode: server.splitTunneling.mode,
						filteredDomains: server.splitTunneling.filteredDomains,
					}
				: undefined,
			error: error
				? {
						message:
							('Error' in error ? error.Error : undefined) ||
							('message' in error ? error.message : undefined),
						code: 'Code' in error ? error.Code : undefined,
						status: 'httpStatus' in error ? error.httpStatus : undefined,
					}
				: undefined,
		},
		browserProxySettings,
		webRtcPolicy,
		networkErrors: networkLog?.errors || [],
		document: networkLog?.document,
		recentLogs: getRecords().slice(0, maxLogs).map(formatLogRecord),
	};
};
