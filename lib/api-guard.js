import { createHmac, timingSafeEqual } from 'node:crypto';
import { API_SECURITY_HEADERS } from './security.js';

export const SITE_COOKIE_LOCAL = 'reelsdl_site';
export const SITE_COOKIE = '__Secure-reelsdl_site';
export const CLIENT_HEADER = 'x-reelsdl-client';
export const CLIENT_HEADER_VALUE = 'web';
export const SITE_HOSTS = new Set(['reelsdl.net', 'www.reelsdl.net']);
export const API_HOSTS = new Set(['get.reelsdl.net']);
export const API_PATHS = new Set(['/api/resolve', '/api/download', '/api/health']);
// Set by the Cloudflare Worker (worker.js) on every request it proxies to Vercel.
export const PROXY_HOST_HEADER = 'x-reelsdl-host';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function siteLockToken() {
  const secret = process.env.DOWNLOAD_TOKEN_SECRET || 'replace-this-local-development-secret';
  return createHmac('sha256', secret).update('reelsdl-site-lock').digest('hex').slice(0, 32);
}

function cookieName() {
  return isProduction() ? SITE_COOKIE : SITE_COOKIE_LOCAL;
}

function firstHost(value) {
  return String(value || '').split(',')[0].trim().split(':')[0].toLowerCase();
}

export function isProxiedSiteRequest(request) {
  return SITE_HOSTS.has(firstHost(request.headers.get(PROXY_HOST_HEADER)));
}

export function publicHostname(request) {
  const proxied = firstHost(request.headers.get(PROXY_HOST_HEADER));
  if (SITE_HOSTS.has(proxied)) return proxied;
  const forwarded = firstHost(request.headers.get('x-forwarded-host'));
  if (API_HOSTS.has(forwarded) || SITE_HOSTS.has(forwarded)) return forwarded;
  return firstHost(request.headers.get('host'));
}

export function isLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function isAllowedWebOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (isLocalDevHost(host)) {
      return url.protocol === 'http:' && !isProduction();
    }
    return url.protocol === 'https:' && SITE_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function isAllowedApiHost(request) {
  const host = firstHost(request.headers.get('host'));
  const forwarded = firstHost(request.headers.get('x-forwarded-host'));
  if (API_HOSTS.has(host) || API_HOSTS.has(forwarded)) return true;
  return !isProduction() && (isLocalDevHost(host) || isLocalDevHost(forwarded));
}

export function isAllowedApiPath(pathname) {
  return API_PATHS.has(pathname);
}

export function hasValidSiteCookie(request) {
  const name = cookieName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return false;
  const got = Buffer.from(match[1].trim());
  const expected = Buffer.from(siteLockToken());
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

export function hasClientHeader(request) {
  return (request.headers.get(CLIENT_HEADER) || '').toLowerCase() === CLIENT_HEADER_VALUE;
}

export function hasJsonContentType(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  return type.startsWith('application/json');
}

export function allowApiPreflight(request) {
  if (!isAllowedApiHost(request)) return false;
  const origin = request.headers.get('origin');
  return Boolean(origin && isAllowedWebOrigin(origin));
}

export function allowApiCaller(request) {
  if (!isAllowedApiHost(request)) return false;

  const origin = request.headers.get('origin');
  if (origin) return isAllowedWebOrigin(origin);

  const referer = request.headers.get('referer');
  if (referer) return isAllowedWebOrigin(referer);

  const hostname = publicHostname(request);
  if (isLocalDevHost(hostname) && !isProduction()) return true;

  if (!hasValidSiteCookie(request)) return false;
  const fetchSite = (request.headers.get('sec-fetch-site') || '').toLowerCase();
  return fetchSite === 'same-site' || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function corsHeaders(request) {
  const origin = request?.headers?.get('origin') || '';
  const headers = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': `${CLIENT_HEADER}, content-type`,
    'access-control-max-age': '600',
    vary: 'origin'
  };
  if (origin && isAllowedWebOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

export function apiResponseHeaders(request) {
  return {
    ...API_SECURITY_HEADERS,
    ...corsHeaders(request)
  };
}

export function siteLockCookieHeader({ local = false } = {}) {
  const name = local ? SITE_COOKIE_LOCAL : SITE_COOKIE;
  const parts = [
    `${name}=${siteLockToken()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 400}`
  ];
  if (!local) parts.push('Secure', 'Domain=.reelsdl.net');
  return parts.join('; ');
}
