/* c8 ignore start */

/** What the user says is wrong, picked in the report dialog. */
export enum SupportIssueCategory {
	VPN_DETECTED = 'vpn-detected',
	SITE_UNREACHABLE = 'site-unreachable',
	WRONG_LOCATION = 'wrong-location',
	SLOW = 'slow',
	OTHER = 'other',
}

/** Kind of evidence found in the visible content of the page. */
export enum PageSignalType {
	VPN_DETECTED = 'vpn-detected',
	GEO_BLOCKED = 'geo-blocked',
	ACCESS_DENIED = 'access-denied',
	BOT_CHALLENGE = 'bot-challenge',
	PAGE_ERROR = 'page-error',
}

export interface PageSignal {
	type: PageSignalType;
	/** Where the evidence was found. */
	source: 'text' | 'title' | 'frame' | 'http-status';
	/** Short extract around the match (omitted when the user excludes page content). */
	excerpt?: string;
}

/** Raw data read from the page by the script injected in the tab. */
export interface RawPageInspection {
	title: string;
	lang: string;
	readyState: string;
	headings: string[];
	text: string;
	textLength: number;
	frameHosts: string[];
	metaRefresh?: string;
	navigation?: {
		responseStatus?: number;
		nextHopProtocol?: string;
		type?: string;
		durationMs?: number;
	};
}

export interface PageInspection {
	/** Set when the page could not be read (browser error page, store page, etc.). */
	unavailableReason?: string;
	title?: string;
	lang?: string;
	readyState?: string;
	headings?: string[];
	/** Visible text, truncated. */
	textExcerpt?: string;
	textLength?: number;
	frameHosts?: string[];
	metaRefresh?: string;
	navigation?: RawPageInspection['navigation'];
	signals: PageSignal[];
}

export interface NetworkErrorEntry {
	time: number;
	/** URL without query string nor fragment. */
	url: string;
	type: string;
	method: string;
	/** net::ERR_* code for failed requests. */
	error?: string;
	/** HTTP status for completed requests with an error status. */
	statusCode?: number;
	fromCache?: boolean;
	ip?: string;
}

export interface SettingStatus {
	controlledBy?: string;
	value?: unknown;
}

/** Data only the background service worker knows. */
export interface SupportDiagnostics {
	connection: {
		state: string;
		proxyEnabled: boolean;
		since?: number;
		server?: {
			id: string | number;
			name: string;
			entryCountry?: string;
			exitCountry: string;
			exitCity?: string | null;
			exitIp: string;
			secureCore?: boolean;
			proxyHost: string;
			proxyPort: number;
		};
		splitTunneling?: {
			mode?: string;
			filteredDomains?: string[];
		};
		error?: {
			message?: string;
			code?: number | string;
			status?: number;
		};
	};
	browserProxySettings?: SettingStatus;
	webRtcPolicy?: SettingStatus;
	networkErrors: NetworkErrorEntry[];
	recentLogs: unknown[];
}

export interface SupportReport {
	version: 1;
	createdAt: string;
	issue: {
		category: SupportIssueCategory;
		description: string;
	};
	site?: {
		/** Origin and path only: query string and fragment are dropped. */
		url: string;
		hostname: string;
		tabStatus?: string;
		/** How split tunneling treats this site in the active connection. */
		splitTunneling?: {
			mode?: string;
			listed: boolean;
			routedThroughVpn: boolean;
		};
		page: PageInspection;
	};
	connection: SupportDiagnostics['connection'];
	settings: Record<string, unknown>;
	browserProxySettings?: SettingStatus;
	webRtcPolicy?: SettingStatus;
	networkErrors: NetworkErrorEntry[];
	environment: {
		extensionVersion: string;
		browser: string;
		browserSubType?: string;
		platform?: string;
		languages: readonly string[];
		timeZone: string;
		timeZoneOffsetMinutes: number;
	};
	account?: {
		plan?: string;
		maxTier?: number;
	};
	recentLogs: unknown[];
	collectionErrors: string[];
}

/* c8 ignore stop */
