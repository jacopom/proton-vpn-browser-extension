'use background';
import {getCurrentState} from '../state';
import {getRecords} from '../log/record';
import {timeoutAfter} from '../tools/delay';
import {getTabNetworkErrors} from './networkErrors';
import type {SettingStatus, SupportDiagnostics} from './SupportReport';

const maxLogs = 50;
const maxLogEntryLength = 1000;

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

const truncateLog = (entry: unknown) => {
	try {
		const json = JSON.stringify(entry);

		return json.length > maxLogEntryLength
			? json.slice(0, maxLogEntryLength) + '…'
			: entry;
	} catch {
		return `${entry}`;
	}
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

	const [browserProxySettings, webRtcPolicy, networkErrors] = await Promise.all(
		[
			// Only the mode: the PAC script itself holds the server list
			readSetting(chromeApi.proxy?.settings, (value) => value?.mode),
			readSetting(
				chromeApi.privacy?.network?.webRTCIPHandlingPolicy,
				(value) => value,
			),
			typeof tabId === 'number' ? getTabNetworkErrors(tabId) : [],
		],
	);

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
		networkErrors,
		recentLogs: getRecords().slice(0, maxLogs).map(truncateLog),
	};
};
