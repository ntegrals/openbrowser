import type { ElementRef } from '../types.js';

export interface DOMRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TargetInfo {
	targetId: string;
	type: 'page' | 'iframe' | 'worker' | 'other';
	url: string;
	title?: string;
	attached: boolean;
}

export interface TargetAllTrees {
	mainTree: PageTreeNode;
	iframeTrees: Array<{
		targetInfo: TargetInfo;
		tree: PageTreeNode;
		parentNodeId?: number;
	}>;
}

export interface InteractedElement {
	index: ElementRef;
	tagName: string;
	text?: string;
	role?: string;
	ariaLabel?: string;
	action: string;
	timestamp: number;
}

export const MatchLevel = {
	EXACT: 'exact',
	PARTIAL: 'partial',
	FUZZY: 'fuzzy',
	NONE: 'none',
} as const;
export type MatchLevel = (typeof MatchLevel)[keyof typeof MatchLevel];

export interface SimplifiedNode {
	tag: string;
	text?: string;
	attrs: Record<string, string>;
	children: SimplifiedNode[];
	index?: ElementRef;
	isInteractive: boolean;
}

export interface PageTreeNode {
	tagName: string;
	nodeType: 'element' | 'text';
	text?: string;
	attributes: Record<string, string>;
	children: PageTreeNode[];

