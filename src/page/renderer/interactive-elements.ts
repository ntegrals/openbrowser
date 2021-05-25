/**
 * Determine if an element is interactive and should get a ref index.
 */

const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'textarea', 'select', 'option',
  'details', 'summary', 'label',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'tab', 'menuitem', 'checkbox', 'radio',
  'switch', 'slider', 'textbox', 'combobox', 'listbox',
  'searchbox', 'spinbutton',
]);

export function isInteractive(
  tag: string,
  attributes: Record<string, string>,
): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (attributes.role && INTERACTIVE_ROLES.has(attributes.role)) return true;
  if (attributes.onclick) return true;
  if (attributes.tabindex && attributes.tabindex !== '-1') return true;
  if (attributes.contenteditable === 'true') return true;
  return false;
}
