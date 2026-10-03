import { defineMiddleware } from 'astro:middleware';
import { API_HOSTS, isAllowedApiPath, isLocalDevHost, isProxiedSiteRequest, publicHostname, SITE_HOSTS, siteLockCookieHeader } from '../lib/api-guard.js';
import { API_SECURITY_HEADERS, SITE_SECURITY_HEADERS, applyHeaders } from '../lib/security.js';

const SITE_ORIGIN = 'https://reelsdl.net';

function withHeaders(response, map) {
  applyHeaders(response.headers, map);
  return response;
}

// Permanent redirect to the same path on the website, so search engines
// consolidate every other hostname into reelsdl.net.
function redirectToSite(url, headers = {}) {
  return new Response(null, {
    status: 301,
    headers: { location: `${SITE_ORIGIN}${url.pathname}${url.search}`, ...headers }
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url } = context;
  const { pathname } = url;
  const hostname = publicHostname(context.request);

  if (API_HOSTS.has(hostname)) {
    if (pathname === '/robots.txt') {
      // Crawling is allowed (except /api/) so Google can see the 301s to reelsdl.net.
      return withHeaders(new Response('User-agent: *\nDisallow: /api/\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      }), API_SECURITY_HEADERS);
    }
    if (!isAllowedApiPath(pathname)) {
      return redirectToSite(url, { 'x-content-type-options': 'nosniff' });
    }
    const response = await next();
    return withHeaders(response, API_SECURITY_HEADERS);
  }

  // www and the raw *.vercel.app production hostname must not serve a duplicate site.
  if (hostname === 'www.reelsdl.net'
    || (hostname.endsWith('.vercel.app') && process.env.VERCEL_ENV === 'production' && !isProxiedSiteRequest(context.request))) {
    return redirectToSite(url);
  }

  if (pathname.startsWith('/api/') && !isLocalDevHost(hostname)) {
    return withHeaders(Response.json({ error: 'Use https://get.reelsdl.net' }, { status: 404 }), API_SECURITY_HEADERS);
  }

  const response = await next();
  if (import.meta.env.PROD) {
    applyHeaders(response.headers, SITE_SECURITY_HEADERS);
    if (pathname === '/sw.js') {
      response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
      response.headers.set('service-worker-allowed', '/');
    } else if (pathname.startsWith('/_astro/')) {
      response.headers.set('cache-control', 'public, max-age=31536000, immutable');
    } else {
      response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
    }
  }
  if (SITE_HOSTS.has(hostname)) {
    response.headers.append('set-cookie', siteLockCookieHeader());
  } else if (isLocalDevHost(hostname)) {
    response.headers.append('set-cookie', siteLockCookieHeader({ local: true }));
  }
  return response;
});
