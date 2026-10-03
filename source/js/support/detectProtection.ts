import type {DocumentResponse, ProtectionVendor} from './SupportReport';

interface VendorFingerprint {
	vendor: string;
	role: ProtectionVendor['role'];
	/** Header names (lowercase) or `name: value` regular expressions. */
	headers?: (string | [string, RegExp])[];
	cookies?: RegExp[];
	/** Hosts of scripts or frames loaded by the page. */
	hosts?: RegExp[];
	/** Text displayed on block pages. */
	text?: RegExp[];
}

const fingerprints: VendorFingerprint[] = [
	{
		vendor: 'Cloudflare',
		role: 'cdn',
		headers: ['cf-ray', 'cf-cache-status', ['server', /cloudflare/i]],
		cookies: [/^__cf_bm$/, /^__cflb$/, /^__cfruid$/],
	},
	{
		vendor: 'Cloudflare Bot Management / Challenge',
		role: 'bot-protection',
		headers: ['cf-mitigated', ['cf-chl-bypass', /.*/]],
		cookies: [/^cf_clearance$/, /^cf_chl/],
		hosts: [/(^|\.)challenges\.cloudflare\.com$/],
		text: [
			/cloudflare ray id/i,
			/performance (?:&|and) security by cloudflare/i,
		],
	},
	{
		vendor: 'Akamai',
		role: 'cdn',
		headers: [
			'akamai-grn',
			'x-akamai-transformed',
			'x-akamai-request-id',
			'akamai-cache-status',
			['server', /akamai/i],
		],
		text: [/errors\.edgesuite\.net/i],
	},
	{
		vendor: 'Akamai Bot Manager',
		role: 'bot-protection',
		cookies: [/^_abck$/, /^bm_sz$/, /^ak_bmsc$/, /^bm_sv$/, /^bm_mi$/],
	},
	{
		vendor: 'Imperva (Incapsula)',
		role: 'waf',
		headers: ['x-iinfo', ['x-cdn', /imperva|incapsula/i]],
		cookies: [/^visid_incap_/, /^incap_ses_/, /^nlbi_/, /^reese84$/],
		text: [/incapsula incident id/i, /powered by imperva/i],
	},
	{
		vendor: 'DataDome',
		role: 'bot-protection',
		headers: ['x-datadome', 'x-datadome-cid', 'x-dd-b'],
		cookies: [/^datadome$/],
		hosts: [/(^|\.)captcha-delivery\.com$/, /(^|\.)datadome\.co$/],
	},
	{
		vendor: 'HUMAN (PerimeterX)',
		role: 'bot-protection',
		cookies: [/^_px\d?$/, /^_pxhd$/, /^_pxvid$/, /^_pxff_/],
		hosts: [
			/(^|\.)perimeterx\.net$/,
			/(^|\.)px-cdn\.net$/,
			/(^|\.)px-cloud\.net$/,
		],
	},
	{
		vendor: 'Kasada',
		role: 'bot-protection',
		headers: ['x-kpsdk-ct', 'x-kpsdk-cd', 'x-kpsdk-st'],
		cookies: [/^KP_UIDz/, /^kpsdk/i],
	},
	{
		vendor: 'AWS CloudFront',
		role: 'cdn',
		headers: ['x-amz-cf-id', 'x-amz-cf-pop', ['server', /cloudfront/i]],
	},
	{
		vendor: 'AWS WAF',
		role: 'waf',
		headers: ['x-amzn-waf-action'],
		cookies: [/^aws-waf-token$/],
		hosts: [/(^|\.)awswaf\.com$/],
	},
	{
		vendor: 'Fastly',
		role: 'cdn',
		headers: ['x-fastly-request-id', ['x-served-by', /cache-/i]],
	},
	{
		vendor: 'Sucuri',
		role: 'waf',
		headers: ['x-sucuri-id', 'x-sucuri-block', ['server', /sucuri/i]],
		text: [/sucuri website firewall/i],
	},
	{
		vendor: 'F5 BIG-IP',
		role: 'waf',
		cookies: [/^TS[0-9a-f]{6,}$/i, /^BIGipServer/],
		text: [
			/the requested url was rejected\. please consult with your administrator/i,
		],
	},
	{
		vendor: 'Azure Front Door',
		role: 'cdn',
		headers: ['x-azure-ref'],
	},
	{
		vendor: 'Google reCAPTCHA',
		role: 'captcha',
		hosts: [/(^|\.)recaptcha\.net$/, /^www\.google\.com\/recaptcha/],
	},
	{
		vendor: 'hCaptcha',
		role: 'captcha',
		hosts: [/(^|\.)hcaptcha\.com$/],
	},
	{
		vendor: 'Arkose Labs',
		role: 'captcha',
		hosts: [/(^|\.)arkoselabs\.com$/, /(^|\.)funcaptcha\.com$/],
	},
];

/** Block/incident identifiers shown on block pages or sent in headers. */
const referencePatterns: [string, RegExp][] = [
	['Cloudflare Ray ID', /ray id:?\s*([0-9a-f]{16})/i],
	['Akamai reference', /reference\s*#\s*([0-9a-f]+(?:\.[0-9a-f]+){2,})/i],
	['Imperva incident ID', /incident id:?\s*([0-9a-z-]{8,})/i],
	['F5 support ID', /support id (?:is)?:?\s*(\d{8,})/i],
	['Request ID', /request id:?\s*([0-9a-z-]{8,})/i],
];

const referenceHeaders: Record<string, string> = {
	'cf-ray': 'Cloudflare Ray ID',
	'akamai-grn': 'Akamai reference',
	'x-amz-cf-id': 'CloudFront request ID',
	'x-iinfo': 'Imperva request info',
	'x-azure-ref': 'Azure Front Door reference',
};

export interface ProtectionInput {
	document?: DocumentResponse;
	hosts: string[];
	text: string;
}

/** Recognize CDN, firewall and anti-bot services from headers, cookie names, loaded hosts and page text. */
export const detectProtection = ({
	document,
	hosts,
	text,
}: ProtectionInput): ProtectionVendor[] => {
	const headers = document?.headers || {};
	const cookieNames = document?.cookieNames || [];
	const found: ProtectionVendor[] = [];

	fingerprints.forEach((fingerprint) => {
		const evidence: string[] = [];

		(fingerprint.headers || []).forEach((header) => {
			const [name, value] = typeof header === 'string' ? [header] : header;
			const actual = headers[name];

			if (actual !== undefined && (!value || value.test(actual))) {
				evidence.push(value ? `header ${name}: ${actual}` : `header ${name}`);
			}
		});

		(fingerprint.cookies || []).forEach((pattern) => {
			cookieNames
				.filter((cookie) => pattern.test(cookie))
				.forEach((cookie) => evidence.push(`cookie ${cookie}`));
		});

		(fingerprint.hosts || []).forEach((pattern) => {
			hosts
				.filter((host) => pattern.test(host))
				.forEach((host) => evidence.push(`loads ${host}`));
		});

		(fingerprint.text || []).forEach((pattern) => {
			const match = pattern.exec(text);

			if (match) {
				evidence.push(`page text "${match[0]}"`);
			}
		});

		if (evidence.length) {
			found.push({
				vendor: fingerprint.vendor,
				role: fingerprint.role,
				evidence: Array.from(new Set(evidence)).slice(0, 6),
			});
		}
	});

	return found;
};

/** Identifiers the site owner (or the vendor) can use to look up why this request was blocked. */
export const findBlockReferences = ({
	document,
	text,
}: Omit<ProtectionInput, 'hosts'>): string[] => {
	const references: string[] = [];
	const seen = new Set<string>();
	/** Same ID shown in several forms: "18.2f3c…" in the page, "0.2f3c…" in akamai-grn, "…-ZRH" in cf-ray. */
	const core = (value: string) =>
		value
			.toLowerCase()
			.replace(/^\d+\./, '')
			.replace(/-[a-z]{3}$/, '');
	const add = (label: string, value: string) => {
		if (!seen.has(core(value))) {
			seen.add(core(value));
			references.push(`${label}: ${value}`);
		}
	};

	Object.entries(referenceHeaders).forEach(([header, label]) => {
		const value = document?.headers[header];

		if (value) {
			add(label, value);
		}
	});

	referencePatterns.forEach(([label, pattern]) => {
		const match = pattern.exec(text);

		if (match?.[1]) {
			add(label, match[1]);
		}
	});

	return references.slice(0, 8);
};
