'use client';

import Link from './Link';
import { Logo } from './Logo';
import { useI18n } from './I18nProvider';

export function Footer({ lead }) {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  return (
    <footer>
      <Link className="footer-brand" href="/">
        <Logo className="footer-logo" />
        ReelsDl.net
      </Link>
      <nav className="legal-nav" aria-label={t('legal')}>
        <Link href="/privacy">{t('privacy')}</Link>
        <Link href="/disclaimer">{t('disclaimer')}</Link>
      </nav>
      <p>
        {lead ? (
          <>
            <Link href={lead.href}>{lead.label}</Link>
            {' · '}
          </>
        ) : null}
        {t('notAffiliated')} · © {year} ReelsDl.net
      </p>
    </footer>
  );
}
