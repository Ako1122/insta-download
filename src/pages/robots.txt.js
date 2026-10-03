import { absUrl } from '../../lib/seo.js';

const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'GoogleOther',
  'Applebot-Extended',
  'Bytespider',
  'meta-externalagent',
  'FacebookBot',
  'Amazonbot',
  'cohere-ai',
  'YouBot',
  'DuckAssistBot'
];

export function GET() {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Disallow: /api/',
    ''
  ];
  for (const agent of AI_CRAWLERS) {
    lines.push(`User-agent: ${agent}`, 'Allow: /', 'Disallow: /api/', '');
  }
  lines.push(`Sitemap: ${absUrl('/sitemap.xml')}`, `Host: ${absUrl('/')}`);
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}
