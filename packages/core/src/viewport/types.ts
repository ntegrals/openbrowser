import { z } from 'zod';
import type { TabId } from '../types.js';

export interface TabDescriptor {
	tabId: TabId;
	url: string;
	title: string;
	isActive: boolean;
}

export interface ViewportSnapshot {
	url: string;
	title: string;
	tabs: TabDescriptor[];
	activeTabIndex: number;
	screenshot?: string;
	domTree?: string;
	selectorMap?: Record<number, string>;
	pixelsAbove?: number;
	pixelsBelow?: number;
}

export interface ViewportHistory {
	url: string;
	title: string;
	tabs: TabDescriptor[];
	interactedElements: Array<{
		index: number;
		description: string;
		action: string;
	}>;
	screenshot?: string;
}

export const LaunchOptionsSchema = z.object({
	headless: z.boolean().default(true),
	relaxedSecurity: z.boolean().default(false),
	extraArgs: z.array(z.string()).default([]),
	windowWidth: z.number().default(1280),
	windowHeight: z.number().default(1100),
	proxy: z
		.object({
			server: z.string(),
			username: z.string().optional(),
			password: z.string().optional(),
		})
		.optional(),
	userDataDir: z.string().optional(),
	browserBinaryPath: z.string().optional(),
	persistAfterClose: z.boolean().default(false),
	channelName: z.string().optional(),
});

export type LaunchOptions = z.infer<typeof LaunchOptionsSchema>;

export interface PageState {
	url: string;
	title: string;
	content?: string;
	screenshot?: string;
}
