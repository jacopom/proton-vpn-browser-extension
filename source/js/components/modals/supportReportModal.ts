'use popup';
import {c} from '../../tools/translate';
import {triggerPromise} from '../../tools/triggerPromise';
import {warn} from '../../log/log';
import {
	collectSupportReport,
	suggestCategory,
	withoutPageContent,
} from '../../support/collectSupportReport';
import {submitSupportReport} from '../../support/submitSupportReport';
import {redactReport} from '../../support/redactReport';
import type {
	SupportIssueCategory,
	SupportReport,
} from '../../support/SupportReport';
import {showModal} from './modals';

const maxDescriptionLength = 2000;

/**
 * "Report a problem" dialog: collects diagnostics about the current tab,
 * lets the user describe the issue and review everything before sending it.
 */
export const configureSupportReportModal = (area: HTMLElement) => {
	const openButton = area.querySelector<HTMLButtonElement>(
		'#support-report-button',
	);
	const modal = area.querySelector<HTMLDialogElement>('#support-report');

	if (!openButton || !modal || openButton.dataset['supportReport'] === 'set') {
		return;
	}

	openButton.dataset['supportReport'] = 'set';

	const site = modal.querySelector<HTMLDivElement>('.support-report-site')!;
	const category = modal.querySelector<HTMLSelectElement>(
		'[name="support-category"]',
	)!;
	const description = modal.querySelector<HTMLTextAreaElement>(
		'[name="support-description"]',
	)!;
	const includePageContent = modal.querySelector<HTMLInputElement>(
		'[name="support-include-page"]',
	)!;
	const preview = modal.querySelector<HTMLPreElement>(
		'.support-report-preview pre',
	)!;
	const status = modal.querySelector<HTMLDivElement>('.support-report-status')!;
	const sendButton = modal.querySelector<HTMLButtonElement>(
		'[data-support-report-send]',
	)!;
	const cancelButton = modal.querySelector<HTMLButtonElement>(
		'[data-support-report-cancel]',
	)!;

	description.maxLength = maxDescriptionLength;
	description.placeholder = c('Placeholder')
		.t`What were you trying to do? What did you expect to happen?`;

	let report: SupportReport | undefined;
	/** Ignore results of an older collection if the dialog was reopened meanwhile. */
	let collectionId = 0;

	const setStatus = (text: string, type: 'error' | 'success' | '' = '') => {
		status.textContent = text;
		status.classList.toggle('error', type === 'error');
		status.classList.toggle('success', type === 'success');
	};

	const getFinalReport = (): SupportReport | undefined => {
		if (!report) {
			return undefined;
		}

		const base = includePageContent.checked
			? report
			: withoutPageContent(report);

		return {
			...base,
			issue: {
				category: category.value as SupportIssueCategory,
				description: description.value.trim().slice(0, maxDescriptionLength),
			},
		};
	};

	const refreshPreview = () => {
		const finalReport = getFinalReport();
		preview.textContent = finalReport
			? JSON.stringify(finalReport, null, 2)
			: '';
	};

	const resetForm = () => {
		report = undefined;
		description.value = '';
		includePageContent.checked = true;
		site.textContent = '';
		preview.textContent = '';
		sendButton.disabled = true;
		sendButton.hidden = false;
		description.disabled = false;
		category.disabled = false;
		includePageContent.disabled = false;
		cancelButton.textContent = c('Action').t`Cancel`;
	};

	const open = async () => {
		const id = ++collectionId;
		resetForm();
		setStatus(c('Info').t`Collecting diagnostics…`);
		showModal(modal);

		try {
			const collected = await collectSupportReport();

			if (id !== collectionId) {
				return;
			}

			report = collected;
			category.value = suggestCategory(collected);
			const hostname = collected.site?.hostname;
			site.textContent = hostname
				? c('Info').t`About ${hostname}`
				: c('Info').t`No website open in the current tab`;
			refreshPreview();
			sendButton.disabled = false;
			setStatus('');
		} catch (error) {
			warn(error);

			if (id === collectionId) {
				setStatus(
					c('Error').t`Diagnostics could not be collected. Please try again.`,
					'error',
				);
			}
		}
	};

	const send = async () => {
		const finalReport = getFinalReport();

		if (!finalReport) {
			return;
		}

		sendButton.disabled = true;
		setStatus(c('Info').t`Sending report…`);

		try {
			const receipt = await submitSupportReport(redactReport(finalReport));
			const reference = receipt.reference;
			setStatus(
				c('Success')
					.t`Report sent. Customer Support may contact you by email. Reference: ${reference}`,
				'success',
			);
			sendButton.hidden = true;
			description.disabled = true;
			category.disabled = true;
			includePageContent.disabled = true;
			cancelButton.textContent = c('Action').t`Close`;
		} catch (error) {
			warn(error);
			sendButton.disabled = false;
			setStatus(
				c('Error').t`The report could not be sent. Please try again.`,
				'error',
			);
		}
	};

	openButton.addEventListener('click', () => triggerPromise(open()));
	sendButton.addEventListener('click', () => triggerPromise(send()));
	[category, includePageContent].forEach((input) =>
		input.addEventListener('change', refreshPreview),
	);
	description.addEventListener('input', refreshPreview);
	modal.addEventListener('close', () => {
		// Drop collected data as soon as the dialog is dismissed
		collectionId++;
		resetForm();
		setStatus('');
	});
};
