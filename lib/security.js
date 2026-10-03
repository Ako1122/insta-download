export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://get.reelsdl.net https://www.googletagmanager.com https://*.google-analytics.com https://*.cdninstagram.com https://*.fbcdn.net https://*.instagram.com",
  "media-src 'self' https://get.reelsdl.net https://*.cdninstagram.com https://*.fbcdn.net",
  "connect-src 'self' https://get.reelsdl.net https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests'
].join('; ');

export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

export const SITE_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': SITE_CSP
};

export const API_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store, no-cache, must-revalidate, private',
  pragma: 'no-cache',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-resource-policy': 'same-site',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': API_CSP,
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload'
};

export function applyHeaders(headers, map) {
  for (const [key, value] of Object.entries(map)) headers.set(key, value);
  return headers;
}
