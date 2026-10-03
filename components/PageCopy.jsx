import { Icon } from './Icons';
import './how-steps.css';

export function PageCopy({ page }) {
  return (
    <>
      <section className="panel how-panel" id="how-it-works" aria-labelledby="how-heading">
        <h2 id="how-heading">{page.how.heading}</h2>
        <ol className="how-steps">
          {page.how.steps.map((step, index) => (
            <li key={step.title}>
              <span className="how-step-num">{String(index + 1).padStart(2, '0')}</span>
              {step.icon ? <span className="step-icon"><Icon name={step.icon} /></span> : null}
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {page.article ? (
        <section className="panel article-panel" aria-labelledby="article-heading">
          <h2 id="article-heading">{page.article.heading}</h2>
          <div className="article-copy">{page.article.text}</div>
        </section>
      ) : null}

      {page.feature ? (
        <section className="home-feature" aria-label="About ReelsDl.net">
          <img
            src={page.feature.image}
            alt={page.feature.alt}
            width="682"
            height="1024"
            loading="lazy"
            decoding="async"
            sizes="(max-width: 720px) 100vw, 680px"
          />
          <div className="home-feature-copy">{page.feature.text}</div>
        </section>
      ) : null}

      <section className="panel" id="faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">{page.faq.heading}</h2>
        <div className="faq-list">
          {page.faq.items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
