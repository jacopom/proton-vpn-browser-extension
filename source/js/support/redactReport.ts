/** Keys whose values must never be sent, wherever they appear in the report. */
const sensitiveKey =
	/token|password|passwd|secret|credential|authorization|cookie|session|^uid$|^creds/i;

/** Values that look like bearer tokens or basic-auth URLs. */
const sensitiveValue = /(?:bearer\s+[\w.~+/-]{10,}|\/\/[^/\s:@]+:[^/\s@]+@)/i;

const redacted = '[redacted]';
const maxDepth = 12;

const redact = (value: unknown, depth: number): unknown => {
	if (depth > maxDepth) {
		return '[truncated]';
	}

	if (typeof value === 'string') {
		return sensitiveValue.test(value)
			? value.replace(new RegExp(sensitiveValue.source, 'gi'), redacted)
			: value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => redact(item, depth + 1));
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				sensitiveKey.test(key) ? redacted : redact(item, depth + 1),
			]),
		);
	}

	return value;
};

/**
 * Defense in depth: the report is built from allow-listed fields, but logs and
 * settings are free-form, so scrub anything that looks like a credential.
 */
export const redactReport = <T>(report: T): T => redact(report, 0) as T;
