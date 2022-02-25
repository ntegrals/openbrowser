/**
 * Compares two elements by their visual layer order.
 * Uses z-index, position, and DOM order.
 */
export function compareLayerOrder(
  a: { zIndex: number; position: string; domIndex: number },
  b: { zIndex: number; position: string; domIndex: number },
): number {
  // Positioned elements come after non-positioned
  const aPositioned = a.position !== 'static' ? 1 : 0;
  const bPositioned = b.position !== 'static' ? 1 : 0;
  if (aPositioned !== bPositioned) return aPositioned - bPositioned;

  // Higher z-index on top
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;

  // Later in DOM on top
  return a.domIndex - b.domIndex;
}
