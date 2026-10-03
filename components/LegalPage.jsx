import { Footer } from './Footer';
import { Header } from './Header';

export function LegalPage({ page, children }) {
  return (
    <>
      <Header />
      <main className="legal-main">
        <article className="legal-article">
          <p className="kicker">Legal</p>
          <h1 id="hero-heading">{page.heading}</h1>
          {children}
        </article>
        <Footer />
      </main>
    </>
  );
}
