import {delay} from '../tools/delay';
import {info} from '../log/log';
import type {SupportReport} from './SupportReport';

export interface SupportReportReceipt {
	/** Reference to quote when following up with Customer Support. */
	reference: string;
	/** True while the API call is stubbed: nothing was actually sent. */
	stub: boolean;
}

/**
 * Send a support report to Proton Customer Support.
 *
 * STUB: the support API endpoint is not available yet, so this only logs the
 * payload and resolves with a fake reference after a short delay.
 *
 * TODO: replace with the real call once the Proton API team provides the
 * endpoint, e.g. using the authenticated `fetchJson` helper from `api.ts`, and
 * map the API error codes to user-facing messages in the report dialog.
 */
export const submitSupportReport = async (
	report: SupportReport,
): Promise<SupportReportReceipt> => {
	const body = JSON.stringify(report);

	info('[support-report] stubbed submission', {
		bytes: body.length,
		category: report.issue.category,
		site: report.site?.hostname,
	});
	// Full payload for developers inspecting the popup console
	console.info('[support-report] payload', report);

	await delay(600);

	return {
		reference: `STUB-${Date.now().toString(36).toUpperCase()}`,
		stub: true,
	};
};
