/* Where the API lives, resolved at runtime rather than baked into the bundle.
 *
 * This file is copied verbatim into the build output, so the API can be
 * repointed by editing it on the host — no rebuild. That matters because the
 * same artifact is meant to run against a free host now and a VPS later.
 *
 * Leave empty to fall back to the local dev server on :4000 (see core/config.ts).
 * Example once the API is deployed:
 *   window.__API_BASE_URL__ = 'https://thegoodfellas-api.onrender.com/api';
 */
window.__API_BASE_URL__ = '';
