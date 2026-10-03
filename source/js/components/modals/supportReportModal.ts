'use popup';
import {c} from '../../tools/translate';
import {triggerPromise} from '../../tools/triggerPromise';
import {warn} from '../../log/log';
import {getGlobalBrowser} from '../../tools/getGlobalBrowser';
import {
	collectSupportReport,
	finalizeReport,
	type ReportChoices,
	suggestCategory,
} from '../../support/collectSupportReport';
import {submitSupportReport} from '../../support/submitSupportReport';
import {redactReport} from '../../support/redactReport';
import {clearDraft, loadDraft, saveDraft} from '../../support/reportDraft';
import {recheckSite, waitForServer} from '../../support/recheckSite';
import type {
	RetryAttempt,
	SupportIssueCategory,
	SupportReport,
	TriedAnswer,
} from '../../support/SupportReport';
import {showModal} from './modals';

const maxDescriptionLength = 2000;
/** Hash of popup.html when the report is opened in its own window. */
const detachedHash = '#support-report';

export interface SupportReportActions {
	/**
	 * Connect to a server similar to the current one, not in `excludedIds`.
	 * Resolves with the chosen server once the connection was requested.
	 */
	tryAnotherServer?: (
		excludedIds: (string | number)[],
	) => Promise<{ID: string | number; Name: string}>;
}

/** Size of a base64 data URL once decoded, in KB. */
const dataUrlKiloBytes = (dataUrl: string) =>
	Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4 / 1024);

const describeRetryForUser = (retry: RetryAttempt): string => {
	const server = retry.server?.name || c('Info').t`VPN off`;
	const result = retry.error
		? retry.error.replace(/^net::/, '')
		: retry.statusCode !== undefined
			? `HTTP ${retry.statusCode}`
			: '';

	if (retry.failure) {
		return c('Info').t`${server}: check not completed (${retry.failure})`;
	}

	return retry.blocked
		? c('Info').t`${server}: still failing ${result}`
		: c('Info').t`${server}: the page loaded fine ${result}`;
};

/**
 * "Report a problem" dialog: collects diagnostics about the current tab,
 * lets the user retry on another server, describe the issue and review
 * everything before sending it. The draft survives the popup closing.
 */
export const configureSupportReportModal = (
	area: HTMLElement,
	actions: SupportReportActions = {},
) => {
	const openButton = area.querySelector<HTMLButtonElement>(
		'#support-report-button',
	);
	const modal = area.querySelector<HTMLDialogElement>('#support-report');

	if (!openButton || !modal || openButton.dataset['supportReport'] === 'set') {
		return;
	}

	openButton.dataset['supportReport'] = 'set';

	const detached = location.hash === detachedHash;
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
	const retryButton = field<HTMLButtonElement>('[data-support-report-retry]');
	const reloadButton = field<HTMLButtonElement>('[data-support-report-reload]');
	const retryList = field<HTMLUListElement>('.support-report-retries');
	const findings = field<HTMLUListElement>('.support-report-findings');
	const preview = field<HTMLPreElement>('.support-report-preview pre');
	const status = field<HTMLDivElement>('.support-report-status');
	const sendButton = field<HTMLButtonElement>('[data-support-report-send]');
	const discardButton = field<HTMLButtonElement>(
		'[data-support-report-discard]',
	);
	const popOutButton = field<HTMLButtonElement>('[data-support-report-popout]');
	const restartButton = field<HTMLButtonElement>(
		'[data-support-report-restart]',
	);
	const inputs = Array.from(
		modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
			'main select, main textarea, main input',
		),
	);

	description.maxLength = maxDescriptionLength;
	description.placeholder = c('Placeholder')
		.t`What were you trying to do? What did you expect to happen?`;
	popOutButton.hidden = detached;

	let report: SupportReport | undefined;
	let retries: RetryAttempt[] = [];
	let checking: RetryAttempt['kind'] | undefined;
	let sent = false;
	/** Ignore results of an older collection if the dialog was restarted meanwhile. */
	let collectionId = 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const setStatus = (text: string, type: 'error' | 'success' | '' = '') => {
		status.textContent = text;
		status.classList.toggle('error', type === 'error');
		status.classList.toggle('success', type === 'success');
	};

	const getChoices = (): ReportChoices => ({
		category: category.value as SupportIssueCategory,
		description: description.value.trim().slice(0, maxDescriptionLength),
		worksWithoutVpn: withoutVpn.value as TriedAnswer,
		worksWithOtherServer: otherServer.value as TriedAnswer,
		includePageContent: includePageContent.checked,
		includeScreenshot: includeScreenshot.checked,
	});

	const setChoices = (choices: ReportChoices) => {
		category.value = choices.category;
		description.value = choices.description;
		withoutVpn.value = choices.worksWithoutVpn;
		otherServer.value = choices.worksWithOtherServer;
		includePageContent.checked = choices.includePageContent;
		includeScreenshot.checked = choices.includeScreenshot;
	};

	const persist = async () => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = undefined;
		}

		if (report && !sent) {
			await saveDraft({
				report,
				choices: getChoices(),
				retries,
				pendingCheck: checking,
			});
		}
	};

	const schedulePersist = () => {
		if (!saveTimer) {
			saveTimer = setTimeout(() => triggerPromise(persist()), 300);
		}
	};

	const getFinalReport = (): SupportReport | undefined =>
		report && finalizeReport(report, getChoices(), retries);

	const refresh = () => {
		const finalReport = getFinalReport();
		const screenshot = report?.site?.screenshot;
		const busy = !!checking;

		screenshotOption.hidden = !screenshot;
		screenshotImage.hidden = !screenshot || !includeScreenshot.checked;

		if (screenshot && screenshotImage.src !== screenshot) {
			screenshotImage.src = screenshot;
		}

		const canCheck = !!report?.site?.tabId && !busy && !sent;
		retryButton.disabled = !canCheck || !actions.tryAnotherServer;
		retryButton.hidden = !actions.tryAnotherServer;
		reloadButton.disabled = !canCheck;
		sendButton.disabled = !report || busy || sent;
		restartButton.disabled = busy || sent;

		retryList.replaceChildren(
			...retries.map((retry) => {
				const item = document.createElement('li');
				item.textContent = describeRetryForUser(retry);
				item.classList.toggle('warning', retry.blocked || !!retry.failure);
				item.classList.toggle('ok', !retry.blocked && !retry.failure);

				return item;
			}),
		);

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

	const showReport = (collected: SupportReport) => {
		report = collected;
		const hostname = collected.site?.hostname;
		site.textContent = hostname
			? c('Info').t`About ${hostname}`
			: c('Info').t`No website open in the current tab`;
		refresh();
	};

	const resetForm = () => {
		report = undefined;
		retries = [];
		checking = undefined;
		sent = false;
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
		sendButton.hidden = false;
		discardButton.textContent = c('Action').t`Discard`;
		refresh();
	};

	const collectNew = async (tabId?: number) => {
		const id = ++collectionId;
		resetForm();
		setStatus(c('Info').t`Collecting diagnostics…`);
		showModal(modal);

		try {
			const collected = await collectSupportReport({tabId});

			if (id !== collectionId) {
				return;
			}

			category.value = suggestCategory(collected);
			showReport(collected);
			setStatus('');
			await persist();
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

	/** Reopen the saved report instead of collecting a new one. */
	const restore = async (): Promise<boolean> => {
		const draft = await loadDraft();

		if (!draft) {
			return false;
		}

		collectionId++;
		resetForm();
		retries = draft.retries || [];
		setChoices(draft.choices);
		showReport(draft.report);
		showModal(modal);
		setStatus(
			draft.pendingCheck
				? c('Info')
						.t`The previous check was interrupted when the popup closed. Check the page again, or open the report in a window to keep it visible.`
				: c('Info').t`Your report was restored.`,
		);

		if (draft.pendingCheck) {
			await persist();
		}

		return true;
	};

	/** Fill in the troubleshooting answers from what the checks showed. */
	const updateAnswers = () => {
		const completed = retries.filter((retry) => !retry.failure);
		const others = completed.filter((retry) => retry.kind === 'other-server');
		const withoutServer = completed.filter((retry) => !retry.server);

		if (others.length) {
			otherServer.value = others.some((retry) => !retry.blocked) ? 'yes' : 'no';
		}

		if (withoutServer.length) {
			withoutVpn.value = withoutServer.some((retry) => !retry.blocked)
				? 'yes'
				: 'no';
		}
	};

	const runCheck = async (kind: RetryAttempt['kind']) => {
		const tabId = report?.site?.tabId;

		if (!report || typeof tabId !== 'number' || checking) {
			return;
		}

		checking = kind;
		refresh();
		await persist();
		let server: {ID: string | number; Name: string} | undefined;

		try {
			if (kind === 'other-server') {
				const excluded = [
					...(report.connection.server ? [report.connection.server.id] : []),
					...retries
						.map((retry) => retry.server?.id)
						.filter((id): id is string | number => id !== undefined),
				];
				setStatus(c('Info').t`Connecting to another server…`);
				server = await actions.tryAnotherServer!(excluded);
				const name = server.Name;
				setStatus(c('Info').t`Connecting to ${name}…`);
				await waitForServer(server.ID);
			}

			setStatus(c('Info').t`Reloading the page and checking it…`);
			retries = [...retries, await recheckSite(tabId, kind)];
			updateAnswers();
			setStatus('');
		} catch (error) {
			const message =
				error instanceof Error ? error.message : `${error || 'unknown'}`;

			if (server) {
				// The switch happened: keep a trace of the failed check for support
				retries = [
					...retries,
					{
						time: Date.now(),
						kind,
						server: {
							id: server.ID,
							name: server.Name,
							exitCountry: '',
							exitIp: '',
						},
						signals: [],
						protection: [],
						blockReferences: [],
						blocked: true,
						failure: message,
					},
				];
			}

			setStatus(message, 'error');
		} finally {
			checking = undefined;
			refresh();
			await persist();
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
			sent = true;
			await clearDraft();
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
			discardButton.textContent = c('Action').t`Close`;
			refresh();
		} catch (error) {
			warn(error);
			sendButton.disabled = false;
			setStatus(
				c('Error').t`The report could not be sent. Please try again.`,
				'error',
			);
		}
	};

	const popOut = async () => {
		await persist();
		const browserApi = getGlobalBrowser() as any as typeof chrome;
		await browserApi.windows.create({
			url: browserApi.runtime.getURL('popup.html') + detachedHash,
			type: 'popup',
			width: 460,
			height: 780,
		});
		window.close();
	};

	openButton.addEventListener('click', () =>
		triggerPromise(
			restore().then((restored) => (restored ? undefined : collectNew())),
		),
	);
	restartButton.addEventListener('click', () => {
		const tabId = report?.site?.tabId;
		triggerPromise(clearDraft().then(() => collectNew(tabId)));
	});
	retryButton.addEventListener('click', () =>
		triggerPromise(runCheck('other-server')),
	);
	reloadButton.addEventListener('click', () =>
		triggerPromise(runCheck('reload')),
	);
	sendButton.addEventListener('click', () => triggerPromise(send()));
	popOutButton.addEventListener('click', () => triggerPromise(popOut()));
	discardButton.addEventListener('click', () => {
		collectionId++;
		triggerPromise(clearDraft());
		resetForm();
		setStatus('');

		if (detached) {
			window.close();
		}
	});
	inputs.forEach((input) => {
		input.addEventListener('change', () => {
			refresh();
			schedulePersist();
		});
		input.addEventListener('input', () => {
			refresh();
			schedulePersist();
		});
	});

	// Reopen an unfinished report: the popup closes whenever it loses focus
	triggerPromise(restore());
};
