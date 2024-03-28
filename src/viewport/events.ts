export interface ViewportEventMap {
  'page-ready': { url: string };
  'content-ready': undefined;
  'tab-opened': { url: string };
  'tab-closed': { tabIndex: number };
  'tab-changed': { tabIndex: number };
  'crash': { reason: string };
  'blank-page': { url: string };
  'url-blocked': { url: string };
  'download': { filename: string; url: string };
  'auto-screenshot': { buffer: Buffer; reason: string };
  'viewport-state': { url: string; title: string; tabCount: number };
  'shutdown': undefined;
}

export interface ViewportRequestMap {
  'get-snapshot': { request: undefined; response: string };
}
