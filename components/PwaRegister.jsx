'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { useI18n } from './I18nProvider';

export function PwaRegister() {
  const { t } = useI18n();
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (standalone) return undefined;

    const onPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!installEvent) return null;

  async function installApp() {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  }

  return (
    <button className="header-action" type="button" onClick={() => void installApp()}>
      <Icon name="download" />
      {t('install')}
    </button>
  );
}
