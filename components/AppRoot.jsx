import { DownloadPage } from './DownloadPage';
import { DisclaimerCopy } from './DisclaimerCopy';
import { I18nProvider } from './I18nProvider';
import { LegalPage } from './LegalPage';
import { PrivacyCopy } from './PrivacyCopy';
import { legalPages } from '@/lib/legal.js';
import { audioPage, homePage } from '@/lib/site.jsx';

export function AppRoot({ pageId = 'home', initialLocale = 'en' }) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      {pageId === 'privacy' ? (
        <LegalPage page={legalPages.privacy}>
          <PrivacyCopy />
        </LegalPage>
      ) : null}
      {pageId === 'disclaimer' ? (
        <LegalPage page={legalPages.disclaimer}>
          <DisclaimerCopy />
        </LegalPage>
      ) : null}
      {pageId === 'audio' ? <DownloadPage page={audioPage} /> : null}
      {pageId === 'home' ? <DownloadPage page={homePage} /> : null}
    </I18nProvider>
  );
}
