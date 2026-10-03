import { pageMetadata } from './site.jsx';

export const legalPages = {
  privacy: {
    path: '/privacy',
    heading: 'Privacy Policy',
    metadata: pageMetadata({
      metadata: {
        title: 'Privacy Policy | ReelsDl.net',
        description: 'Privacy Policy for ReelsDl.net. What this Instagram downloader collects and how that information is used.',
        keywords: ['ReelsDl.net privacy', 'Instagram downloader privacy'],
        alternates: { canonical: '/privacy' },
        openGraph: {
          title: 'Privacy Policy | ReelsDl.net',
          description: 'Privacy Policy for ReelsDl.net.',
          url: '/privacy'
        },
        twitter: {
          title: 'Privacy Policy | ReelsDl.net',
          description: 'Privacy Policy for ReelsDl.net.'
        }
      }
    })
  },
  disclaimer: {
    path: '/disclaimer',
    heading: 'Disclaimer',
    metadata: pageMetadata({
      metadata: {
        title: 'Disclaimer | ReelsDl.net',
        description: 'ReelsDl.net does not host Instagram videos or images. Download links come from Instagram CDN servers.',
        keywords: ['ReelsDl.net disclaimer', 'not affiliated with Instagram'],
        alternates: { canonical: '/disclaimer' },
        openGraph: {
          title: 'Disclaimer | ReelsDl.net',
          description: 'Disclaimer for ReelsDl.net.',
          url: '/disclaimer'
        },
        twitter: {
          title: 'Disclaimer | ReelsDl.net',
          description: 'Disclaimer for ReelsDl.net.'
        }
      }
    })
  }
};
