import {Storage, storage} from '../tools/storage';
import type {ReportChoices} from './collectSupportReport';
import type {RetryAttempt, SupportReport} from './SupportReport';

/** Drafts older than this are dropped: the page and connection have likely changed. */
const draftMaxAge = 30 * 60 * 1000;
/** Older browsers only allow 1 MB in session storage: drop the screenshot above this size. */
const maxDraftSize = 900 * 1024;

export interface ReportDraft {
	savedAt: number;
	report: SupportReport;
	choices: ReportChoices;
	retries: RetryAttempt[];
	/** A check was running when the popup closed: it was interrupted. */
	pendingCheck?: RetryAttempt['kind'];
}

/**
 * Session storage only: the draft holds page content and a screenshot, so it
 * is kept while the browser runs (the popup closes as soon as it loses focus)
 * but never written to disk.
 */
const storedDraft = storage.item<ReportDraft>(
	'support-report-draft',
	Storage.SESSION,
);

export const loadDraft = async (): Promise<ReportDraft | undefined> => {
	const draft = await storedDraft.get().catch(() => undefined);

	if (!draft?.report || Date.now() - draft.savedAt > draftMaxAge) {
		return undefined;
	}

	return draft;
};

export const saveDraft = async (
	draft: Omit<ReportDraft, 'savedAt'>,
): Promise<void> => {
	let saved: ReportDraft = {...draft, savedAt: Date.now()};

	if (JSON.stringify(saved).length > maxDraftSize && saved.report.site) {
		saved = {
			...saved,
			report: {
				...saved.report,
				site: {...saved.report.site, screenshot: undefined},
			},
		};
	}

	await storedDraft.set(saved);
};

export const clearDraft = () => storedDraft.remove();
