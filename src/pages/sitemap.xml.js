import { absUrl } from '../../lib/seo.js';

const PATHS = [
  { path: '/', priority: '1.0' },
  { path: '/instagram-audio-downloader', priority: '0.9' },
  { path: '/privacy', priority: '0.3' },
  { path: '/disclaimer', priority: '0.3' }
];

export function GET() {
  const lastmod = new Date().toISOString();
  const urls = PATHS.map(({ path, priority }) => `  <url>
    <loc>${absUrl(path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' }
  });
}
