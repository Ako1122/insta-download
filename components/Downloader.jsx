'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { apiUrl, withApiHost } from '@/lib/api';
import { SITE_EMAIL } from '@/lib/seo';
import { Icon } from './Icons';
import { useI18n } from './I18nProvider';

export function Downloader({
  mode,
  kicker,
  heading,
  lede,
  inputLabel,
  placeholder,
  messages,
  summary
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const resultsRef = useRef(null);
  const inputRef = useRef(null);
  const hasUrl = Boolean(url.trim());
  const audio = mode === 'audio';
  const headingText = t(audio ? 'audioHeading' : 'mediaHeading');
  const ledeText = t(audio ? 'audioLede' : 'mediaLede');
  const placeholderText = t(audio ? 'audioPlaceholder' : 'mediaPlaceholder');
  const inputLabelText = t(audio ? 'audioInputLabel' : 'mediaInputLabel');
  const copy = {
    emptyUrl: t(audio ? 'emptyUrlAudio' : 'emptyUrl'),
    invalidUrl: t('invalidUrl'),
    resolveFailed: t(audio ? 'resolveFailedAudio' : 'resolveFailed'),
    unexpected: t(audio ? 'unexpectedAudio' : 'unexpected'),
    clipboardBlocked: t('clipboardBlocked')
  };

  useEffect(() => {
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!desktop) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  async function resolveUrl(nextUrl) {
    const value = extractInstagramUrl(nextUrl ?? url);
    if (value && value !== String(nextUrl ?? url).trim()) setUrl(value);
    setError('');
    if (!value) return setError(copy.emptyUrl);
    if (!looksLikeInstagramUrl(value)) return setError(copy.invalidUrl);
    if (loading) return;
    setLoading(true);
    setResult(null);
    try {
      const cached = readClientPostCache(value, mode);
      const mapped = cached || await fetchResolvedPost(value, mode, copy.resolveFailed);
      if (cached) {
        void fetchResolvedPost(value, mode, copy.resolveFailed)
          .then((fresh) => {
            writeClientPostCache(value, mode, fresh);
            setResult(fresh);
          })
          .catch(() => {});
      } else {
        writeClientPostCache(value, mode, mapped);
      }
      setUrl('');
      setResult(mapped);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (caught) {
      setError(caught.message || copy.unexpected);
    } finally {
      setLoading(false);
    }
  }

  async function pasteLink() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) return;
      const next = extractInstagramUrl(text);
      if (!next) return;
      setUrl(next);
      await resolveUrl(next);
    } catch {
      setError(copy.clipboardBlocked);
    }
  }

  function clearField() {
    setUrl('');
    setError('');
    inputRef.current?.focus();
  }

  function onPaste(event) {
    const raw = event.clipboardData?.getData('text');
    if (!raw?.trim()) return;
    const text = extractInstagramUrl(raw);
    if (!looksLikeInstagramUrl(text)) return;
    event.preventDefault();
    setUrl(text);
    requestAnimationFrame(() => void resolveUrl(text));
  }

  const media = Array.isArray(result?.media) ? result.media : [];
  const count = media.length === 1 ? summary.one : `${media.length}${summary.manySuffix}`;

  return (
    <>
      <section className="hero" aria-labelledby="hero-heading">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h1 id="hero-heading">
          <span className="hero-title">{headingText}</span>
        </h1>
        <p className="lede">{ledeText}</p>
        <form
          className="link-form"
          autoComplete="off"
          suppressHydrationWarning
          onSubmit={(event) => {
            event.preventDefault();
            void resolveUrl();
          }}
          noValidate
        >
          <label className="sr-only" htmlFor="instagram-url">{inputLabelText}</label>
          <div
            className={loading ? 'input-wrap is-loading' : 'input-wrap'}
            aria-busy={loading}
            onClick={(event) => {
              if (event.target.closest('button, a')) return;
              inputRef.current?.focus();
            }}
          >
            <Icon name="link" className="input-icon" />
            <input
              ref={inputRef}
              id="instagram-url"
              name="ig-link"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              placeholder={placeholderText}
              required
              value={url}
              disabled={loading}
              suppressHydrationWarning
              onChange={(event) => setUrl(event.target.value)}
              onPaste={onPaste}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void resolveUrl();
              }}
            />
            {hasUrl ? (
              <button className="paste-button" type="button" disabled={loading} onClick={clearField}>
                <Icon name="clear" />
                {t('clear')}
              </button>
            ) : (
              <button className="paste-button" type="button" disabled={loading} onClick={() => void pasteLink()}>
                <Icon name="paste" />
                {t('paste')}
              </button>
            )}
          </div>
          <button className="sr-only" type="submit" tabIndex={-1}>
            Get
          </button>
          <a className="report-issue" href={reportIssueHref(url, mode, t('reportIssue'))}>
            {t('reportIssue')}
          </a>
        </form>
        {error ? (
          <div className="error-message" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        ) : null}
      </section>

      <section className="results-section" ref={resultsRef} aria-live="polite" hidden={!result}>
        {result ? (
          <>
            <article className={media.length === 1 ? 'ig-post is-single' : 'ig-post'}>
              {media.length > 1 ? (
                <button
                  className="download-button download-all"
                  disabled={downloadProgress !== null}
                  onClick={() => downloadAll(media, mode, setDownloadProgress)}
                  style={{
                    width: '100%',
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <Icon name="download" />
                  {downloadProgress ? (downloadProgress.current + ' / ' + downloadProgress.total + ' \u6B63\u5728\u6253\u5305...') : ('\u4E0B\u8F09\u5168\u90E8 ZIP\uFF08' + media.length + ' \u500B\u6A94\u6848\uFF09')}
                </button>
              ) : null}
              <PostByline result={result} fallbackTitle={summary.defaultTitle} />
              <div className={media.length === 1 ? 'media-grid is-single' : 'media-grid'}>
                {media.map((item, index) => (
                  <MediaCard key={`${item.downloadUrl}-${index}`} item={item} index={index} total={media.length} mode={mode} t={t} />
                ))}
              </div>
              {postCaption(result) ? (
                <p className="ig-caption">
                  {postUsername(result) ? (
                    <a
                      className="ig-username"
                      href={profileHref(result)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {postUsername(result)}
                    </a>
                  ) : null}
                  {' '}
                  {postCaption(result)}
                </p>
              ) : null}
            </article>
            <a className="clear-button" href="/">
              <Icon name="again" />
              {t('downloadAgain')}
            </a>
          </>
        ) : null}
      </section>
    </>
  );
}

function PostByline({ result, fallbackTitle }) {
  const username = postUsername(result);
  if (!username) {
    return (
      <header className="ig-post-head">
        <span className="ig-avatar" aria-hidden="true">R</span>
        <strong className="ig-username">{fallbackTitle}</strong>
      </header>
    );
  }
  return (
    <header className="ig-post-head">
      <span className="ig-avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
      <div className="ig-post-meta">
        <a className="ig-username" href={profileHref(result)} target="_blank" rel="noopener noreferrer">
          {username}
        </a>
        <span className="ig-handle">@{username}</span>
      </div>
    </header>
  );
}

function postUsername(result) {
  if (result.username && /^[A-Za-z0-9._]{1,30}$/.test(result.username)) return result.username;
  const match = String(result.title || '').match(/(?:by |^)([A-Za-z0-9._]{1,30})(?:\s+[—–-]|\s+on Instagram|$)/i);
  return match?.[1] && !/^(video|photo|post|reel|public)$/i.test(match[1]) ? match[1] : null;
}

function postCaption(result) {
  if (result.caption) return result.caption;
  const title = String(result.title || '');
  const parts = title.split(/\s+[—–-]\s+/);
  return parts.length > 1 ? parts.slice(1).join(' — ').replace(/\u2026$/, '').trim() : '';
}

function profileHref(result) {
  const username = postUsername(result);
  if (result.profileUrl) return result.profileUrl;
  return username ? 'https://www.instagram.com/' + username + '/' : 'https://www.instagram.com/';
}

function randomFileId() {
  return crypto.randomUUID().slice(0, 8);
}

function downloadFilename(item, index, mode) {
  const itemNumber = index + 1;
  const isAudio = mode === 'audio' || item.type === 'audio';
  const kind = item.type === 'video' ? 'video' : item.type === 'audio' ? 'audio' : 'photo';
  if (kind === 'video') return 'ReelsDl.net-' + randomFileId() + '.mp4';
  if (isAudio && item.original) return 'ReelsDl-audio-' + itemNumber;
  if (isAudio) return 'ReelsDl-audio-' + itemNumber + '.mp3';
  return 'ReelsDl-photo-' + itemNumber + '.jpg';
}

function MediaCard({ item, index, total, mode, t }) {
  const itemNumber = index + 1;
  const suffix = total > 1 ? ' ' + itemNumber : '';
  const isAudio = mode === 'audio' || item.type === 'audio';
  const isOriginalAudio = isAudio && item.original;
  const kind = item.type === 'video' ? 'video' : item.type === 'audio' ? 'audio' : 'photo';
  const label = (isOriginalAudio ? t('downloadAudio') : isAudio ? t('downloadMp3') : kind === 'video' ? t('downloadVideo') : t('downloadPhoto')) + suffix;
  const downloadName = useMemo(() => downloadFilename(item, index, mode), [item, index, mode]);
  const [previewFailed, setPreviewFailed] = useState(false);
  const thumb = previewFailed ? null : lightPreview(item);
  const cdnUrl = item.directUrl || null;
  const apiHref = item.downloadUrl;
  const primaryUrl = cdnUrl || apiHref;
  const showApiFallback = Boolean(cdnUrl && apiHref && kind !== 'photo');
  return (
    <article className="media-card">
      <div className={kind === 'video' ? 'media-preview is-video' : isAudio ? 'media-preview is-audio' : 'media-preview'}>
        {thumb ? (
          <>
            <div className="loading-shimmer" />
            <img
              src={thumb}
              alt={isAudio ? 'Instagram reel cover ' + itemNumber : kind === 'video' ? 'Instagram video cover ' + itemNumber : 'Instagram photo ' + itemNumber}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              referrerPolicy={isApiAsset(thumb) ? 'origin' : 'no-referrer'}
              onLoad={clearShimmer}
              onError={() => setPreviewFailed(true)}
            />
          </>
        ) : (
          <div className="media-placeholder" aria-hidden="true">
            <Icon name={isAudio ? 'audio' : kind === 'video' ? 'reels' : 'download'} />
          </div>
        )}
        {kind === 'video' ? <span className="media-kind">Video</span> : null}
        {isAudio ? <span className="media-kind">MP3</span> : null}
      </div>
      <div className="media-footer">
        <a
          className="download-button"
          href={primaryUrl}
          download={downloadName}
          aria-label={label}
          {...(cdnUrl ? { rel: 'noreferrer', referrerPolicy: 'no-referrer' } : {})}
        >
          <Icon name="download" />
          {label}
        </a>
        {showApiFallback ? (
          <a
            className="download-direct"
            href={apiHref}
            download={downloadName}
          >
            <Icon name="link" />
            {t('viaSite')}
          </a>
        ) : null}
      </div>
    </article>
  );
}

async function downloadAll(media, mode, setDownloadProgress) {
  setDownloadProgress({ current: 0, total: media.length });
  const zip = new JSZip();
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    const dlUrl = item.directUrl || item.downloadUrl;
    const name = downloadFilename(item, i, mode);
    try {
      const resp = await fetch(dlUrl, { referrerPolicy: item.directUrl ? 'no-referrer' : 'origin' });
      const blob = await resp.blob();
      zip.file(name, blob);
    } catch (e) {
      console.warn('Failed to fetch ' + name, e);
    }
    setDownloadProgress({ current: i + 1, total: media.length });
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = 'instagram-download.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  setDownloadProgress(null);
}

function isApiAsset(url) {
  return /\/api\/download(?:\?|$)/.test(url) || /(?:^|\/\/)get\.reelsdl\.net\//i.test(url);
}

function lightPreview(item) {
  const url = item.coverUrl || item.previewUrl;
  if (!url || /\.(mp4|webm|mov|m4v|mp3|m4a)(\?|$)/i.test(url)) return null;
  return url;
}

function clearShimmer(event) {
  event.currentTarget.parentElement?.querySelector('.loading-shimmer')?.remove();
}

function reportIssueHref(url, mode, subjectLabel) {
  const page = mode === 'audio' ? 'Audio MP3' : 'Reels Downloader';
  const subject = 'ReelsDl.net --- ' + (subjectLabel || page);
  const parts = ['What went wrong:', ''];
  const trimmed = url.trim();
  if (trimmed) parts.push('Instagram link: ' + trimmed, '');
  return 'mailto:' + SITE_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(parts.join('\n'));
}

function fetchResolvedPost(value, mode, resolveFailed) {
  return fetch(apiUrl('/api/resolve'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-reelsdl-client': 'web'
    },
    body: JSON.stringify(mode === 'audio' ? { url: value, mode: 'audio' } : { url: value })
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || resolveFailed);
    const mapped = {
      ...body,
      media: Array.isArray(body.media) ? body.media.map((item) => ({
        ...item,
        previewUrl: withApiHost(item.previewUrl),
        coverUrl: withApiHost(item.coverUrl),
        sourceUrl: item.sourceUrl?.startsWith('/') ? withApiHost(item.sourceUrl) : item.sourceUrl,
        downloadUrl: withApiHost(item.downloadUrl),
        directUrl: item.directUrl && /^https:\/\//i.test(item.directUrl) ? item.directUrl : null
      })) : []
    };
    if (!mapped.media.length) throw new Error(resolveFailed);
    return mapped;
  });
}

var CLIENT_CACHE_MS = 45 * 60 * 1000;
var POST_PATH_KINDS = new Set(['p', 'reel', 'reels', 'tv']);

function instagramPostCacheId(value) {
  try {
    var parsed = new URL(value.startsWith('http') ? value : 'https://' + value);
    var parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    var first = parts.toLowerCase();
    var second = (parts || '').toLowerCase();
    if (POST_PATH_KINDS.has(first) && parts && second !== 'audio') return parts;
    if (first === 'share' && POST_PATH_KINDS.has(second) && parts) return parts;
    if (POST_PATH_KINDS.has(second) && parts) return parts;
  } catch (e) {
    return null;
  }
  return null;
}

function clientCacheStorageKey(value, mode) {
  var id = instagramPostCacheId(value);
  if (!id) return null;
  return 'reelsdl_post_' + mode + '_' + id;
}

function readClientPostCache(value, mode) {
  var key = clientCacheStorageKey(value, mode);
  if (!key) return null;
  try {
    var raw = sessionStorage.getItem(key);
    if (!raw) return null;
    var entry = JSON.parse(raw);
    if (!entry?.at || Date.now() - entry.at > CLIENT_CACHE_MS) return null;
    if (!Array.isArray(entry.result?.media) || !entry.result.media.length) return null;
    return entry.result;
  } catch (e) {
    return null;
  }
}

function writeClientPostCache(value, mode, result) {
  var key = clientCacheStorageKey(value, mode);
  if (!key || !result?.media?.length) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), result: result }));
  } catch (e) {
    /* ignore quota */
  }
}

function extractInstagramUrl(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  var parts = text.split(/(?=https?:\/\/)/i).map(function(part) { return part.trim(); }).filter(Boolean);
  if (parts.length > 1) {
    var urls = parts.filter(function(part) { return looksLikeInstagramUrl(part); });
    if (urls.length) return urls[urls.length - 1];
  }
  return text;
}

function looksLikeInstagramUrl(value) {
  try {
    var parsed = new URL(value.startsWith('http') ? value : 'https://' + value);
    return /^(www\.)?instagram\.com$/i.test(parsed.hostname);
  } catch (e) {
    return /instagram\.com/i.test(value);
  }
}
