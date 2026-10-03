/** Keep only origin and path: query strings and fragments may hold tokens or personal data. */
export const stripUrl = (url: string): string => {
	try {
		const parsed = new URL(url);

		return parsed.origin + parsed.pathname;
	} catch {
		return url.split(/[?#]/)[0] || '';
	}
};
