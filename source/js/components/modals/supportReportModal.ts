'use popup';
import {c} from '../../tools/translate';
import {triggerPromise} from '../../tools/triggerPromise';
import {warn} from '../../log/log';
import {
	collectSupportReport,
	finalizeReport,
	suggestCategory,
} from '../../support/collectSupportReport';
import {submitSupportReport} from '../../support/submitSupportReport';
import {redactReport} from '../../support/redactReport';
import type {
	SupportIssueCategory,
	SupportReport,
	TriedAnswer,
} from '../../support/SupportReport';
import {showModal} from './modals';

const maxDescriptionLength = 2000;

/** Size of a base64 data URL once decoded, in KB. */
const dataUrlKiloBytes = (dataUrl: string) =>
	Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4 / 1024);

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

	const field = <T extends Element>(selector: string) =>
		modal.querySelector<T>(selector)!;
	const site = field<HTMLDivElement>('.support-report-site');
	const category = field<HTMLSelectElement>('[name="support-category"]');
	const withoutVpn = field<HTMLSelectElement>('[name="support-without-vpn"]');
	const otherServer = field<HTMLSelectElement>('[name="support-other-server"]');
	const description = field<HTMLTextAreaElement>(
		'[name="support-description"]',
	);
	const includePageContent = field<HTMLInputElement>(
		'[name="support-include-page"]',
	);
	const includeScreenshot = field<HTMLInputElement>(
		'[name="support-include-screenshot"]',
	);
	const screenshotOption = field<HTMLLabelElement>(
		'.support-report-screenshot-option',
	);
	const screenshotImage = field<HTMLImageElement>('.support-report-screenshot');
	const findings = field<HTMLUListElement>('.support-report-findings');
	const preview = field<HTMLPreElement>('.support-report-preview pre');
	const status = field<HTMLDivElement>('.support-report-status');
	const sendButton = field<HTMLButtonElement>('[data-support-report-send]');
	const cancelButton = field<HTMLButtonElement>('[data-support-report-cancel]');
	const inputs = Array.from(
		modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
			'main select, main textarea, main input',
		),
	);

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

	const getFinalReport = (): SupportReport | undefined =>
		report &&
		finalizeReport(report, {
			category: category.value as SupportIssueCategory,
			description: description.value.trim().slice(0, maxDescriptionLength),
			worksWithoutVpn: withoutVpn.value as TriedAnswer,
			worksWithOtherServer: otherServer.value as TriedAnswer,
			includePageContent: includePageContent.checked,
			includeScreenshot: includeScreenshot.checked,
		});

	const refresh = () => {
		const finalReport = getFinalReport();
		const screenshot = report?.site?.screenshot;

		screenshotOption.hidden = !screenshot;
		screenshotImage.hidden = !screenshot || !includeScreenshot.checked;

		if (screenshot && screenshotImage.src !== screenshot) {
			screenshotImage.src = screenshot;
		}

		findings.replaceChildren(
			...(finalReport?.summary || []).map((line) => {
				const item = document.createElement('li');
				item.textContent = line;
				item.classList.toggle('warning', line.startsWith('⚠'));

				return item;
			}),
		);

		preview.textContent = finalReport
			? JSON.stringify(
					finalReport,
					(key, value) =>
						key === 'screenshot' && typeof value === 'string'
							? `[JPEG screenshot, ${dataUrlKiloBytes(value)} KB, shown above]`
							: value,
					2,
				)
			: '';
	};

	const resetForm = () => {
		report = undefined;
		description.value = '';
		category.selectedIndex = 0;
		withoutVpn.value = 'not-tried';
		otherServer.value = 'not-tried';
		includePageContent.checked = true;
		includeScreenshot.checked = true;
		screenshotImage.removeAttribute('src');
		site.textContent = '';
		inputs.forEach((input) => {
			input.disabled = false;
		});
		sendButton.disabled = true;
		sendButton.hidden = false;
		cancelButton.textContent = c('Action').t`Cancel`;
		refresh();
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
			refresh();
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
				receipt.stub
					? c('Info')
							.t`Test mode: the report was NOT sent, the support API is not connected yet. The full report is in the popup console. Reference: ${reference}`
					: c('Success')
							.t`Report sent. Customer Support may contact you by email. Reference: ${reference}`,
				'success',
			);
			sendButton.hidden = true;
			inputs.forEach((input) => {
				input.disabled = true;
			});
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
	inputs.forEach((input) => {
		input.addEventListener('change', refresh);
		input.addEventListener('input', refresh);
	});
	modal.addEventListener('close', () => {
		// Drop collected data as soon as the dialog is dismissed
		collectionId++;
		resetForm();
		setStatus('');
	});
};
