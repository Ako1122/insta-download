import { Icon } from './Icons';

const FEATURES = [
  {
    icon: 'reels',
    title: 'HD Reels & videos',
    text: 'Save public Reels and Instagram videos as MP4 — No watermark.'
  },
  {
    icon: 'download',
    title: 'Photos & carousels',
    text: 'Grab a single photo or a whole carousel in one paste.'
  },
  {
    icon: 'audio',
    title: 'MP3 from any Reel',
    text: 'Pull the soundtrack and keep it as an audio file.'
  },
  {
    icon: 'link',
    title: 'Paste a link. Done.',
    text: 'Copy from Instagram, paste here, press Enter. That is the whole flow.'
  },
  {
    icon: 'unlock',
    title: 'No login needed',
    text: 'Public posts only. We never ask for your Instagram account.'
  },
  {
    icon: 'device',
    title: 'Phone, tablet, desktop',
    text: 'Works in the browser — or install the WebApp for one-tap access.'
  }
];

export function FeatureShowcase() {
  return (
    <section className="feature-showcase" id="features" aria-labelledby="features-heading">
      <p className="feature-showcase-kicker">What you get</p>
      <h2 id="features-heading">Top features</h2>
      <ul className="feature-showcase-grid">
        {FEATURES.map((item) => (
          <li key={item.title}>
            <span className="feature-showcase-icon" aria-hidden="true">
              <Icon name={item.icon} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
