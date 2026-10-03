'use popup';
import {getGlobalBrowser} from '../tools/getGlobalBrowser';

const maxWidth = 1280;
const quality = 0.7;

const loadImage = (source: string) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Screenshot could not be decoded'));
		image.src = source;
	});

/** Scale down (high-DPI screens produce huge captures) and re-encode as JPEG. */
const shrink = async (dataUrl: string): Promise<string> => {
	const image = await loadImage(dataUrl);
	const scale = Math.min(1, maxWidth / (image.naturalWidth || maxWidth));

	if (scale === 1) {
		return dataUrl;
	}

	const canvas = document.createElement('canvas');
	canvas.width = Math.round(image.naturalWidth * scale);
	canvas.height = Math.round(image.naturalHeight * scale);
	canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);

	return canvas.toDataURL('image/jpeg', quality);
};

/**
 * Capture what the user currently sees in the tab of the given window.
 * Chromium grants this through the `activeTab` permission when the user opens
 * the extension popup on that tab.
 */
export const captureScreenshot = async (windowId: number): Promise<string> => {
	const tabs = (getGlobalBrowser() as any as typeof chrome).tabs;
	const dataUrl: string = await tabs.captureVisibleTab(windowId, {
		format: 'jpeg',
		quality: Math.round(quality * 100),
	});

	return await shrink(dataUrl);
};
