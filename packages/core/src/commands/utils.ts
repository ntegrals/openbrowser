import type { Page } from 'playwright';

export async function scrollPage(
	page: Page,
	direction: 'up' | 'down',
	amount?: number,
): Promise<void> {
	const scrollAmount = amount ?? 500;
	const delta = direction === 'down' ? scrollAmount : -scrollAmount;

	await page.evaluate((d) => {
		window.scrollBy(0, d);
	}, delta);

	// Wait for scroll to complete
	await new Promise((resolve) => setTimeout(resolve, 200));
}

export async function scrollElement(
	page: Page,
	selector: string,
	direction: 'up' | 'down',
	amount?: number,
): Promise<void> {
	const scrollAmount = amount ?? 300;
	const delta = direction === 'down' ? scrollAmount : -scrollAmount;

	await page.evaluate(
		({ sel, d }) => {
			const el = document.querySelector(sel);
			if (el) el.scrollBy(0, d);
		},
		{ sel: selector, d: delta },
	);

	await new Promise((resolve) => setTimeout(resolve, 200));
}

export function buildGoogleSearchUrl(query: string): string {
	return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=14`;
}
