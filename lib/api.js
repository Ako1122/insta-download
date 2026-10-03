export const DEFAULT_SITE_ORIGIN = 'https://reelsdl.net';
export const DEFAULT_API_ORIGIN = 'https://get.reelsdl.net';

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL
  || (process.env.NODE_ENV === 'production' ? DEFAULT_API_ORIGIN : '')
).replace(/\/+$/, '');

export function apiUrl(path = '') {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${suffix}` : suffix;
}

export function withApiHost(url) {
  if (!url || /^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}
