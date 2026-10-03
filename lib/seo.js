export const SITE_ORIGIN = (process.env.SITE_URL || 'https://reelsdl.net').replace(/\/+$/, '');
export const SITE_NAME = 'ReelsDl.net';
export const SITE_EMAIL = 'hello@reelsdl.net';

export function absUrl(path = '/') {
  if (!path) return SITE_ORIGIN;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export const OG_IMAGE_PATH = '/instagram-reels-downloader-reelsdl-net.jpg';

export const DEFAULT_OG_IMAGE = {
  url: absUrl(OG_IMAGE_PATH),
  width: 682,
  height: 1024,
  alt: 'Instagram Reels downloader on ReelsDl.net — paste a public link and save the video'
};

export const organizationJsonLd = {
  '@type': 'Organization',
  '@id': absUrl('/#organization'),
  name: SITE_NAME,
  legalName: SITE_NAME,
  url: absUrl('/'),
  email: SITE_EMAIL,
  logo: {
    '@type': 'ImageObject',
    url: absUrl('/icon-512.png'),
    width: 512,
    height: 512
  },
  image: absUrl(OG_IMAGE_PATH),
  description: 'Free web tool to download public Instagram Reels, photos, carousel posts, and reel audio as MP3. No Instagram login. Public posts only.',
  contactPoint: {
    '@type': 'ContactPoint',
    email: SITE_EMAIL,
    contactType: 'customer support'
  }
};

export const homeHowToJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  '@id': absUrl('/#howto'),
  name: 'How to download Instagram Reels with ReelsDl.net',
  description: 'Download a public Instagram Reel, photo, or carousel as MP4 or JPG without logging in.',
  totalTime: 'PT1M',
  tool: { '@type': 'HowToTool', name: SITE_NAME },
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Copy the Instagram link',
      text: 'Open Instagram, tap the three dots on a public Reel or post, and choose Copy Link.',
      image: absUrl('/assets/copy-instagram-reel-link-reelsdl-net.avif')
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Paste the link on ReelsDl.net',
      text: 'Paste the public Instagram URL into the box on https://reelsdl.net and confirm Get.',
      image: absUrl('/assets/paste-instagram-link-reelsdl-net.avif')
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Download the file',
      text: 'Preview the public media and click Download to save the MP4 video or JPG photo to your device.',
      image: absUrl('/assets/download-instagram-reel-reelsdl-net.avif')
    }
  ]
};

export const audioHowToJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  '@id': absUrl('/instagram-audio-downloader#howto'),
  name: 'How to download Instagram Reel audio as MP3',
  description: 'Extract the soundtrack from a public Instagram Reel or video and save it as an MP3.',
  totalTime: 'PT1M',
  tool: { '@type': 'HowToTool', name: `${SITE_NAME} Audio Downloader` },
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Copy the Reel or video link',
      text: 'Copy the public Instagram Reel or video URL from the Instagram share menu.',
      image: absUrl('/assets/instagram-reel-audio-track-reelsdl-net.webp')
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Paste it on the audio page',
      text: 'Open https://reelsdl.net/instagram-audio-downloader, paste the link, and start the conversion.',
      image: absUrl('/assets/paste-instagram-link-reelsdl-net.avif')
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Save the MP3',
      text: 'Click Download Audio to save the MP3 soundtrack to your downloads folder.',
      image: absUrl('/assets/download-instagram-reel-reelsdl-net.avif')
    }
  ]
};
