// Cloudflare Worker for https://reelsdl.net — proxies the website to the Vercel origin.
// The API lives on https://get.reelsdl.net, which points at Vercel directly (DNS only).
const SITE_HOST = 'reelsdl.net';
const SITE_ORIGIN = `https://${SITE_HOST}`;

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    // www, get.reelsdl.net (if ever routed here) and any other host → canonical site, same path.
    if (incoming.hostname.toLowerCase() !== SITE_HOST || incoming.protocol !== 'https:') {
      return new Response(null, {
        status: 301,
        headers: { location: `${SITE_ORIGIN}${incoming.pathname}${incoming.search}` }
      });
    }

    if (incoming.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Use https://get.reelsdl.net' }, {
        status: 404,
        headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' }
      });
    }

    return proxyToOrigin(request, incoming, env.API_ORIGIN);
  }
};

async function proxyToOrigin(request, incoming, configuredOrigin) {
  let origin;
  try {
    origin = new URL(configuredOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error();
  } catch {
    return Response.json({
      error: 'Cloudflare proxy is not configured. Set API_ORIGIN to the production Vercel URL.'
    }, { status: 503 });
  }

  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(request.headers);
  headers.set('x-reelsdl-host', SITE_HOST);
  headers.set('x-forwarded-host', SITE_HOST);
  headers.delete('host');

  const hashedAsset = incoming.pathname.startsWith('/_astro/');

  try {
    const upstream = await fetch(new Request(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      cf: {
        cacheEverything: hashedAsset,
        cacheTtl: hashedAsset ? 31_536_000 : 0
      }
    }));

    return withSiteHeaders(incoming.pathname, upstream, origin);
  } catch {
    return Response.json({
      error: 'The site is temporarily unavailable.'
    }, { status: 502 });
  }
}

function withSiteHeaders(pathname, upstream, origin) {
  const headers = new Headers(upstream.headers);
  headers.delete('age');
  headers.delete('cf-cache-status');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');

  // Never leak the Vercel hostname in a redirect.
  const location = headers.get('location');
  if (location) {
    try {
      const target = new URL(location, origin);
      if (target.host === origin.host) headers.set('location', `${SITE_ORIGIN}${target.pathname}${target.search}`);
    } catch {}
  }

  if (pathname.startsWith('/_astro/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    headers.set('CDN-Cache-Control', 'no-store');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
