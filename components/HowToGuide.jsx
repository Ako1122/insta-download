import './page-arrange.css';

const PASTE_ICON = (
  <svg className="how-guide-paste-icon" xmlns="http://www.w3.org/2000/svg" fill="#656d88" height="24" width="24" aria-hidden="true">
    <path d="M12 5.125q.375 0 .637-.263.263-.262.263-.662 0-.375-.263-.638Q12.375 3.3 12 3.3t-.637.262q-.263.263-.263.663 0 .375.263.637.262.263.637.263ZM5.3 20.5q-.75 0-1.275-.525Q3.5 19.45 3.5 18.7V5.3q0-.75.525-1.275Q4.55 3.5 5.3 3.5h4.425q.2-.725.837-1.213Q11.2 1.8 12 1.8q.825 0 1.463.487.637.488.837 1.213h4.4q.75 0 1.275.525.525.525.525 1.275v13.4q0 .75-.525 1.275-.525.525-1.275.525Zm0-1.5h13.4q.1 0 .2-.1t.1-.2V5.3q0-.1-.1-.2t-.2-.1h-2.2v.8q0 .75-.525 1.288-.525.537-1.275.537H9.3q-.75 0-1.275-.537Q7.5 6.55 7.5 5.8V5H5.3q-.1 0-.2.1t-.1.2v13.4q0 .1.1.2t.2.1Z" />
  </svg>
);

const COPY = {
  reels: {
    copyTitle: 'Copy Reels Link',
    pasteTitle: 'Paste Reels Link',
    downloadTitle: 'Download Reels',
    copy: (
      <p>
        Copy Reels Video Link from instagram by taping on 3 Dots Button (&#8942;) and then Click on <b>&quot;Copy Link&quot;</b>
      </p>
    ),
    paste: (
      <p>
        Paste the &quot;copied link&quot; in Input Box (Paste directly, tap on Paste {PASTE_ICON} icon).
        <br />
        Then press <kbd className="how-guide-key">Enter</kbd>
      </p>
    ),
    download: (
      <p>
        Wait a bit to get Reels Video & then Click <b>&quot;Download Video&quot;</b> to Save Reels (mp4) video
      </p>
    )
  },
  audio: {
    copyTitle: 'Copy Reels/Video Link',
    pasteTitle: 'Paste Reels/Video Link',
    downloadTitle: 'Download Audio',
    copy: (
      <p>
        Copy Reels/Video Link for Audio from instagram by taping on 3 Dots Button (&#8942;) and then Click on <b>&quot;Copy Link&quot;</b>
      </p>
    ),
    paste: (
      <p>
        Paste the &quot;copied link&quot; in Input Box (Paste directly, tap on Paste {PASTE_ICON} icon).
        <br />
        Then press <kbd className="how-guide-key">Enter</kbd>
      </p>
    ),
    download: (
      <p>
        Wait a Few seconds to convert audio File & then Click <b>&quot;Download Audio&quot;</b> to Save <b>Reels Video to Audio </b> (mp3) file
      </p>
    )
  }
};

export function HowToGuide({ heading, type = 'reels' }) {
  const copy = COPY[type] || COPY.reels;

  return (
    <section className="panel how-guide-panel" id="how-it-works" aria-labelledby="how-heading">
      <h2 id="how-heading">{heading}</h2>
      <ol className="how-guide">
        <li className="how-guide-step">
          <span className="how-guide-num">01</span>
          <div className="how-guide-visual">
            <img
              src="/assets/copy-instagram-reel-link-reelsdl-net.avif"
              alt="Copy an Instagram Reel link from the share menu, then paste it on ReelsDl.net"
              title="Copy an Instagram Reel link"
              width="576"
              height="180"
              loading="lazy"
              decoding="async"
              sizes="(max-width: 720px) 92vw, 240px"
            />
          </div>
          <h3>{copy.copyTitle}</h3>
          {copy.copy}
        </li>
        <li className="how-guide-step">
          <span className="how-guide-num">02</span>
          <div className="how-guide-visual">
            <img
              src="/assets/paste-instagram-link-reelsdl-net.avif"
              alt="Paste a public Instagram link into ReelsDl.net and press Get"
              title="Paste an Instagram link on ReelsDl.net"
              width="786"
              height="154"
              loading="lazy"
              decoding="async"
              sizes="(max-width: 720px) 92vw, 240px"
            />
          </div>
          <h3>{copy.pasteTitle}</h3>
          {copy.paste}
        </li>
        <li className="how-guide-step">
          <span className="how-guide-num">03</span>
          <div className="how-guide-visual is-download">
            <img
              src="/assets/download-instagram-reel-reelsdl-net.avif"
              alt="Download an Instagram Reel as MP4 on ReelsDl.net"
              title="Download an Instagram Reel on ReelsDl.net"
              width="941"
              height="187"
              loading="lazy"
              decoding="async"
              sizes="(max-width: 720px) 92vw, 240px"
            />
          </div>
          <h3>{copy.downloadTitle}</h3>
          {copy.download}
        </li>
      </ol>
    </section>
  );
}
