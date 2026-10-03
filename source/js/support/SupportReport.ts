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
	/** The page talks about VPNs or proxies without a clear block message. */
	VPN_MENTIONED = 'vpn-mentioned',
}

/** User's answer to the troubleshooting questions of the dialog. */
export type TriedAnswer = 'not-tried' | 'yes' | 'no';

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
	/** Hosts serving scripts (anti-bot vendors are recognizable by them). */
	scriptHosts: string[];
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
	scriptHosts?: string[];
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

export interface RedirectHop {
	from: string;
	to: string;
	statusCode: number;
}

/** Response of the main document of the tab, as the browser received it. */
export interface DocumentResponse {
	time: number;
	url: string;
	statusCode: number;
	statusLine?: string;
	/** IP the response came from (the VPN proxy when the site is routed through it). */
	ip?: string;
	fromCache?: boolean;
	/** Allow-listed headers only (CDN, WAF, cache, geo, request IDs). */
	headers: Record<string, string>;
	/** Names of cookies the site tried to set; values are never kept. */
	cookieNames: string[];
	redirects: RedirectHop[];
}

export interface ProtectionVendor {
	vendor: string;
	role: 'cdn' | 'waf' | 'bot-protection' | 'captcha';
	evidence: string[];
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
	document?: DocumentResponse;
	/** Most recent first, one line per record. */
	recentLogs: string[];
}

export interface ServerDetails {
	domain?: string;
	tier?: number;
	features: string[];
	city?: string | null;
	hostCountry?: string | null;
	/** Load of the VPN server in percent. */
	load?: number;
	serverLabel?: string | null;
	serverStatus?: number;
	servicesDownReason?: string | null;
}

export interface SupportReport {
	version: 2;
	createdAt: string;
	/** Plain-language findings for the support agent, most important first. */
	summary: string[];
	issue: {
		category: SupportIssueCategory;
		description: string;
		/** Does the site work with the VPN turned off? */
		worksWithoutVpn: TriedAnswer;
		/** Does the site work with another VPN server? */
		worksWithOtherServer: TriedAnswer;
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
		document?: DocumentResponse;
		/** CDN, firewall, anti-bot and captcha services recognized on the site. */
		protection: ProtectionVendor[];
		/** Block or incident IDs the site owner can look up (Cloudflare Ray ID, Akamai reference...). */
		blockReferences: string[];
		/** JPEG data URL of the visible part of the page, when the user agrees to attach it. */
		screenshot?: string;
	};
	connection: SupportDiagnostics['connection'] & {
		serverDetails?: ServerDetails;
	};
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
	recentLogs: string[];
	collectionErrors: string[];
}

/* c8 ignore stop */
