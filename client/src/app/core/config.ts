declare global {
  interface Window {
    /** Set by public/config.js, which ships alongside the build and is editable on the host. */
    __API_BASE_URL__?: string;
  }
}

const configured = window.__API_BASE_URL__?.trim();

/** Trailing slashes are stripped so callers can always append `/leads` etc. */
export const API_BASE_URL = configured ? configured.replace(/\/+$/, '') : 'http://localhost:4000/api';
