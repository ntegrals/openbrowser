import type { PageTreeNode, DOMRect } from '../types.js';

/**
 * Filter overlapping elements by paint order (z-index).
 * When two interactive elements overlap, only keep the one painted on top.
 */
export function filterByPaintOrder(nodes: PageTreeNode[]): PageTreeNode[] {
	if (nodes.length === 0) return nodes;

	// Group nodes by approximate position
	const gridSize = 50;
	const grid = new Map<string, PageTreeNode[]>();

	for (const node of nodes) {
		if (!node.rect || !node.isVisible) continue;

		const cellX = Math.floor(node.rect.x / gridSize);
		const cellY = Math.floor(node.rect.y / gridSize);
		const key = `${cellX},${cellY}`;

		if (!grid.has(key)) grid.set(key, []);
		grid.get(key)!.push(node);
	}

	const hidden = new Set<PageTreeNode>();

	for (const cellNodes of grid.values()) {
		if (cellNodes.length < 2) continue;

		for (let i = 0; i < cellNodes.length; i++) {
			for (let j = i + 1; j < cellNodes.length; j++) {
				const a = cellNodes[i];
				const b = cellNodes[j];

				if (rectsOverlap(a.rect!, b.rect!, 0.5)) {
					const paintA = a.paintOrder ?? 0;
					const paintB = b.paintOrder ?? 0;

					if (paintA < paintB) {
						hidden.add(a);
					} else if (paintB < paintA) {
						hidden.add(b);
					}
				}
			}
		}
	}

	return nodes.filter((n) => !hidden.has(n));
}

function rectsOverlap(a: DOMRect, b: DOMRect, threshold: number): boolean {
	const overlapX = Math.max(
		0,
		Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
	);
	const overlapY = Math.max(
		0,
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
	);

	const overlapArea = overlapX * overlapY;
	const smallerArea = Math.min(a.width * a.height, b.width * b.height);

	return smallerArea > 0 && overlapArea / smallerArea >= threshold;
}
