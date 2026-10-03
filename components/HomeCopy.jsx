import Link from './Link';
import { FeatureShowcase } from './FeatureShowcase';
import { HowToGuide } from './HowToGuide';
import './page-arrange.css';

export function HomeCopy({ page }) {
  return (
    <div className="home-copy">
      <p className="home-audio-cta">
        <Link href="/instagram-audio-downloader">+ Reels Audio - mp3 Download</Link>
      </p>

      <FeatureShowcase />

      <nav className="home-jump" aria-label="On this page">
        <a href="#features">Features</a>
        <a href="#about">About</a>
        <a href="#how-it-works">How to</a>
        <a href="#why">Why</a>
        <a href="#offers">Offers</a>
        <a href="#faq">Questions</a>
      </nav>

      <section className="panel article-panel" id="about" aria-labelledby="home-intro-heading">
        <h2 id="home-intro-heading">About ReelsDl.net</h2>
        <div className="article-copy">
          <p>
            <b>ReelsDl.net</b> is a free Instagram Reels downloader.
            Paste a public Instagram link to save Reels as MP4, photos as JPG,
            carousel posts, or convert Reel audio to MP3. No login is required.
            Private posts cannot be downloaded.
          </p>
          <p>
            If you post photos and Reels every day, you can{' '}
            <b>download Instagram Reels</b> and watch them offline on{' '}
            <Link href="/">ReelsDl.net</Link>.
            The guide below shows how to <b>save Instagram Reels videos</b>{' '}
            and download <b>Instagram to MP4</b>.
          </p>
          <p>
            Once the video is saved, a lot of people still rewrite the caption
            or bio before they post again. A{' '}
            <a href="https://cursivee.app" target="_blank" rel="noopener noreferrer">
              cursive text generator
            </a>{' '}
            turns ordinary typing into script you can paste into Instagram.
          </p>
        </div>
      </section>

      <HowToGuide heading={page.how.heading} type="reels" />

      <section className="copy-split" aria-labelledby="reels-downloader-heading">
        <h2 id="reels-downloader-heading">Reels Downloader</h2>
        <p>
          Save videos, Reels, and photos from{' '}
          <a
            href="https://about.instagram.com/blog/announcements/introducing-instagram-reels-announcement"
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram
          </a>{' '}
          so you can watch them offline, or keep a collection to share later.
          Use the <b>Instagram Reels Downloader</b> above: paste a public link,
          then save the file. That is <b>Instagram video download MP4</b>.
        </p>
      </section>

      <section className="panel article-panel" id="why" aria-labelledby="why-heading">
        <h2 id="why-heading">Why ReelsDl.net</h2>
        <div className="article-copy">
          <p>
            <b>ReelsDl.net</b> is a fast way to <b>save Instagram videos</b> —
            Reels, photos, videos, and Stories — in one place.
          </p>
        </div>
        <ul className="copy-grid">
          <li>Download Reels as fast as the link allows.</li>
          <li>Save Instagram Reels without a watermark.</li>
          <li>Instagram Reels download by link.</li>
          <li>Convert video to audio (MP3).</li>
          <li>No login needed.</li>
          <li>Download Reels, videos, and Stories anonymously.</li>
          <li>HD quality videos and photos.</li>
          <li>Photos, carousels, and more.</li>
        </ul>
      </section>

      <section className="panel article-panel" id="offers" aria-labelledby="offers-heading">
        <h2 id="offers-heading">What ReelsDl.net offers</h2>
        <div className="article-copy">
          <p>
            <b>ReelsDl.net</b> downloads public Instagram posts in <b>HD</b>.
            That covers Reels, videos, photos, and carousels.
          </p>
          <p>
            <b>Carousel posts</b> can include several photos, several videos,
            or a mix of both in one Instagram post.
          </p>
        </div>
        <ul className="copy-grid copy-grid-links">
          <li>
            <Link href="/">Reels Downloader</Link>
          </li>
          <li>
            <Link href="/">Photos &amp; Carousel Downloader</Link>
          </li>
          <li>
            <Link href="/">Instagram Videos Downloader</Link>
          </li>
          <li>
            <Link href="/instagram-audio-downloader">Convert video to audio (mp3)</Link>
          </li>
        </ul>
      </section>

      <section className="panel" id="faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">{page.faq.heading}</h2>
        <div className="faq-list">
          {page.faq.items.map((item) => (
            <details key={item.q} open={item.open}>
              <summary>{item.q}</summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
