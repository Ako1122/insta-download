import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { API_BASE } from './api.js';
import { allowApiCaller, allowApiPreflight, apiResponseHeaders, hasJsonContentType, isAllowedApiPath } from './api-guard.js';
import { API_SECURITY_HEADERS } from './security.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_SECRET = process.env.DOWNLOAD_TOKEN_SECRET || 'replace-this-local-development-secret';
const API_ORIGIN = API_BASE;
const apiRequest = new AsyncLocalStorage();
const MAX_BODY_BYTES = 16_000;
const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const MAX_POST_MEDIA = 20;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_LIMIT = 40;
const DOWNLOAD_LIMIT = 80;
const TICKET_MAX_CHARS = 4096;
const TICKET_MAX_MS = 6 * 60 * 1000;
const GLOBAL_FETCH_WINDOW_MS = 60 * 1000;
const GLOBAL_FETCH_LIMIT = 40;
const CACHE_MS = 45 * 60 * 1000;
const CACHE_TTL_SECONDS = Math.round(CACHE_MS / 1000);
const CACHE_MAX = 400;
const CIRCUIT_OPEN_MS = 3 * 60 * 1000;
const CIRCUIT_STRIKE_WINDOW_MS = 2 * 60 * 1000;
const CIRCUIT_TRIPS = 4;
const FFMPEG_TIMEOUT_MS = 50_000;
const rateLimits = new Map();
const downloadLimits = new Map();
const globalFetches = [];
const pageCache = new Map();
const circuit = { openUntil: 0, strikes: 0, lastStrike: 0 };
const SKIP_WALK_KEYS = new Set(['owner', 'user', 'caption', 'user_tags', 'sponsor_tags', 'coauthor_producers', 'biography', 'edge_followed_by', 'edge_follow']);
const require = createRequire(import.meta.url);

export async function handleApiRequest(request) {
  return apiRequest.run(request, () => handleLockedApiRequest(request));
}

async function handleLockedApiRequest(request) {
  const requestUrl = new URL(request.url);
  if (request.method === 'OPTIONS') return corsPreflight(request);
  if (process.env.NODE_ENV === 'production' && TOKEN_SECRET === 'replace-this-local-development-secret') {
    return jsonResponse(503, { error: 'The API is not configured.' });
  }
  if (!isAllowedApiPath(requestUrl.pathname)) return jsonResponse(404, { error: 'Not found.' });
  if (!allowApiCaller(request)) {
    return jsonResponse(403, { error: 'This API is only available on ReelsDl.net.' });
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') return healthResponse();
  if (request.method === 'POST' && requestUrl.pathname === '/api/resolve') {
    if (!hasJsonContentType(request)) {
      return jsonResponse(415, { error: 'Send JSON from ReelsDl.net.' });
    }
    return resolveHandler(request);
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/download') return downloadHandler(request, requestUrl);
  return jsonResponse(405, { error: 'Method not allowed.' });
}

export function healthResponse() {
  return jsonResponse(200, { ok: true });
}

async function resolveHandler(request) {
  const ip = getClientIp(request);
  if (!allowRequest(ip)) return jsonResponse(429, { error: 'Please wait a moment before trying more links.' });

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return jsonResponse(400, { error: error.message });
  }

  const suppliedUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!suppliedUrl) return jsonResponse(400, { error: 'Paste an Instagram URL first.' });
  const mode = body.mode === 'audio' ? 'audio' : 'media';

  let postUrl;
  try {
    postUrl = validateInstagramUrl(suppliedUrl);
  } catch (error) {
    return jsonResponse(400, { error: error.message });
  }

  try {
    const cacheKey = resolveCacheKey(postUrl);
    let parsed = await readPageCache(cacheKey);
    let canonical = parsed
      ? (canonicalizePostUrl(postUrl) || canonicalizeAudioUrl(postUrl) || canonicalizeStoryUrl(postUrl) || postUrl)
      : null;
    if (!parsed) {
      canonical = await followInstagramRedirect(postUrl);
      if (!isSupportedInstagramPath(canonical.pathname)) {
        return jsonResponse(400, { error: 'That link did not resolve to a public Instagram reel, post, story, or audio page.' });
      }
      if (isCircuitOpen()) {
        return jsonResponse(503, { error: 'Instagram is temporarily limiting requests. Try again in a few minutes.' });
      }
      if (!allowGlobalFetch()) {
        return jsonResponse(429, { error: 'The site is busy resolving links. Try again shortly.' });
      }
      parsed = await fetchPublicPost(canonical);
      if (mode === 'audio') await attachDashAudioFromMediaInfo(parsed, canonical);
      await writePageCache(cacheKey, parsed);
      const redirectedKey = resolveCacheKey(canonical);
      if (redirectedKey !== cacheKey) await writePageCache(redirectedKey, parsed);
    }
    const nativeAudio = parsed.media.filter((item) => item.type === 'audio');
    const items = mode === 'audio'
      ? (nativeAudio.length ? nativeAudio : parsed.media.filter((item) => item.type === 'video'))
      : parsed.media;
    if (mode === 'audio' && !items.length) {
      return jsonResponse(404, { error: 'No downloadable audio was found for that link.' });
    }
    const media = items.map((item, index) => {
      const originalAudio = item.type === 'audio' || item.original;
      const kind = originalAudio || mode === 'audio' ? 'audio' : item.type;
      const originalIndex = mode === 'audio'
        ? parsed.media.findIndex((candidate) => candidate.sourceUrl === item.sourceUrl)
        : index;
      const standaloneAudio = item.audioUrl && isMediaUrl(item.audioUrl) ? item.audioUrl : null;
      const downloadUrl = `${API_ORIGIN}/api/download?ticket=${encodeTicket({
        iss: 'reelsdl.net',
        aud: 'get.reelsdl.net',
        pageUrl: canonical.toString(),
        url: item.sourceUrl,
        audioUrl: standaloneAudio,
        kind,
        asIs: Boolean(originalAudio),
        index: originalIndex >= 0 ? originalIndex : index,
        hasAudio: item.hasAudio,
        exp: Date.now() + 5 * 60 * 1000
      })}`;
      const previewUrl = lightPreviewUrl(item);
      const coverImage = imagePreviewUrl(item.coverUrl) || previewUrl;
      const proxiedCover = coverImage ? proxiedInlineUrl(coverImage, 'photo') : null;
      const directUrl = (kind === 'audio' && !originalAudio)
        ? null
        : publicCdnUrl(item.sourceUrl);
      if (kind === 'audio') {
        return {
          type: 'audio',
          original: Boolean(originalAudio),
          previewUrl: proxiedCover,
          coverUrl: proxiedCover,
          sourceUrl: item.sourceUrl,
          downloadUrl,
          directUrl
        };
      }
      return {
        type: item.type,
        previewUrl,
        sourceUrl: item.sourceUrl,
        downloadUrl,
        directUrl
      };
    });
    const identity = postIdentity(parsed);
    return jsonResponse(200, {
      title: identity.title,
      username: identity.username,
      caption: identity.caption,
      profileUrl: identity.profileUrl,
      source: parsed.source || 'html',
      mode,
      media
    });
  } catch (error) {
    console.warn('Instagram resolver:', error.message);
    return jsonResponse(502, { error: publicFetchMessage(error) });
  }
}

async function downloadHandler(request, requestUrl) {
  const ip = getClientIp(request);
  if (!allowDownload(ip)) return jsonResponse(429, { error: 'Please wait a moment before downloading more files.' });

  const ticket = requestUrl.searchParams.get('ticket');
  if (!ticket || ticket.length > TICKET_MAX_CHARS) {
    return jsonResponse(403, { error: 'This download link has expired. Fetch the post again.' });
  }
  const payload = decodeTicket(ticket);
  if (!payload || !payload.exp || payload.exp < Date.now() || payload.exp > Date.now() + TICKET_MAX_MS) {
    return jsonResponse(403, { error: 'This download link has expired. Fetch the post again.' });
  }

  const inline = requestUrl.searchParams.get('inline') === '1';
  try {
    if (payload.kind === 'audio') return await downloadAudio(payload, inline);
    if (payload.kind === 'video') return await downloadVideo(payload, inline);
    return await downloadPhoto(payload, inline);
  } catch (error) {
    console.warn('Download error:', error.message);
    if (/no soundtrack|does not contain any stream/i.test(error.message)) {
      return jsonResponse(422, { error: 'This video has no soundtrack to download.' });
    }
    return jsonResponse(502, { error: 'The original media file is no longer available.' });
  }
}

async function downloadAudio(payload, inline = false) {
  const pageUrl = payload.pageUrl && validateInstagramUrl(payload.pageUrl).toString();
  const directVideo = payload.url && isMediaUrl(payload.url) ? payload.url : null;
  const ticketAudio = payload.audioUrl && isMediaUrl(payload.audioUrl) && payload.audioUrl !== directVideo
    ? payload.audioUrl
    : null;
  const directAudio = ticketAudio || await lookupStandaloneAudio(payload);

  // Audio pages expose a standalone file — stream it unchanged (no MP3 convert).
  if (payload.asIs) {
    const original = directAudio || directVideo;
    if (original) return await proxyMedia({ ...payload, url: original, kind: 'audio' }, inline);
  }

  // Prefer a standalone / DASH audio stream when Instagram exposed one.
  if (directAudio && directAudio !== directVideo) {
    try {
      const converted = await extractAudioToMp3(directAudio);
      return fileResponse(converted, payload, 'audio/mpeg', inline);
    } catch (error) {
      console.warn('Direct audio conversion failed:', error.message);
      try {
        return await proxyMedia({ ...payload, url: directAudio, kind: 'audio' }, inline);
      } catch (proxyError) {
        console.warn('Direct audio proxy failed:', proxyError.message);
      }
    }
  }

  // Extract MP3 from a progressive video URL with ffmpeg (silent MP3 if muted).
  if (directVideo) {
    try {
      const converted = await extractAudioToMp3(directVideo);
      return fileResponse(converted, payload, 'audio/mpeg', inline);
    } catch (error) {
      console.warn('Video-to-MP3 extraction failed:', error.message);
      if (/no soundtrack|does not contain any stream|Postprocessing|Requested format is not available|audio codec/i.test(error.message)) {
        throw new Error('This video has no soundtrack to download.');
      }
    }
  }

  throw new Error('Missing or unavailable media URL.');
}

async function extractAudioToMp3(sourceUrl) {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg is not available for audio extraction.');
  if (!isAllowedMediaHost(new URL(sourceUrl).hostname)) throw new Error('Untrusted media host.');

  const dir = mkdtempSync(join(tmpdir(), 'reelstash-audio-'));
  const inputPath = join(dir, 'source.bin');
  const outputPath = join(dir, 'audio.mp3');
  try {
    const response = await safeFetch(new URL(sourceUrl), isAllowedMediaHost, {
      headers: mediaHeaders(),
      maxRedirects: 3
    });
    if (!response.ok || !response.body) throw new Error(`Media server responded with ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > MAX_MEDIA_BYTES) throw new Error('Media file is too large.');
    await writeResponseToFile(response, inputPath);
    try {
      await runFfmpeg([
        '-y',
        '-i', inputPath,
        '-vn',
        '-map', '0:a:0',
        '-acodec', 'libmp3lame',
        '-q:a', '2',
        outputPath
      ], ffmpeg);
    } catch (error) {
      if (!/no soundtrack|does not contain any stream|Stream map|matches no streams/i.test(error.message)) throw error;
      const seconds = Math.max(0.25, probeMediaDuration(inputPath, ffmpeg) || 3);
      await runFfmpeg([
        '-y',
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', String(seconds),
        '-acodec', 'libmp3lame',
        '-q:a', '2',
        outputPath
      ], ffmpeg);
    }
    if (!existsSync(outputPath)) throw new Error('ffmpeg did not write an MP3 file.');
    return { dir, filePath: outputPath };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function probeMediaDuration(filePath, ffmpegPath) {
  try {
    const result = spawnSync(/* turbopackIgnore: true */ ffmpegPath, ['-hide_banner', '-i', filePath], {
      encoding: 'utf8',
      timeout: 12_000,
      windowsHide: true
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
  } catch {
    return 0;
  }
}

async function filterVideosWithAudioStream(items) {
  const results = await Promise.all(items.map(async (item) => {
    if (item.audioUrl && isMediaUrl(item.audioUrl)) return item;
    if (item.hasAudio === false) return null;
    if (!item.sourceUrl || !isMediaUrl(item.sourceUrl)) return null;
    try {
      const hasStream = await mediaFileHasAudioStream(item.sourceUrl);
      return hasStream ? item : null;
    } catch (error) {
      console.warn('Audio stream probe failed, keeping candidate:', error.message);
      return item;
    }
  }));
  return results.filter(Boolean);
}

async function mediaFileHasAudioStream(sourceUrl) {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return true;
  if (!isAllowedMediaHost(new URL(sourceUrl).hostname)) return true;

  const dir = mkdtempSync(join(tmpdir(), 'reelstash-probe-'));
  const inputPath = join(dir, 'source.bin');
  try {
    const response = await safeFetch(new URL(sourceUrl), isAllowedMediaHost, {
      headers: mediaHeaders(),
      maxRedirects: 3
    });
    if (!response.ok || !response.body) return true;
    const length = Number(response.headers.get('content-length') || 0);
    // Skip expensive probes for large reels; download path still validates the soundtrack.
    if (length > 25 * 1024 * 1024) return true;
    await writeResponseToFile(response, inputPath);
    return probeLocalFileHasAudio(inputPath, ffmpeg);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function probeLocalFileHasAudio(filePath, ffmpegPath) {
  return new Promise((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ ffmpegPath, ['-hide_banner', '-i', filePath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(true);
    }, 12_000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 32_000) child.kill('SIGTERM');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(true);
    });
    child.on('close', () => {
      clearTimeout(timeout);
      resolve(/Stream #\d+:\d+.*Audio:/i.test(stderr));
    });
  });
}

async function writeResponseToFile(response, filePath) {
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
}

function runFfmpeg(args, ffmpegPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, new Error('ffmpeg timed out while extracting audio.'));
    }, FFMPEG_TIMEOUT_MS);
    child.on('error', (error) => finish(reject, new Error(`ffmpeg could not start: ${error.message}`)));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) return finish(resolve);
      const detail = stderr.replace(/\s+/g, ' ').slice(-400);
      if (/does not contain any stream|Stream map.*matches no streams|matches no streams/i.test(stderr)) {
        return finish(reject, new Error('This video has no soundtrack to download.'));
      }
      finish(reject, new Error(`ffmpeg audio extraction failed${detail ? `: ${detail}` : '.'}`));
    });
  });
}

async function downloadVideo(payload, inline = false) {
  const hasDirectUrl = Boolean(payload.url && isMediaUrl(payload.url));
  if (!hasDirectUrl) throw new Error('Missing media URL.');

  // Fast path: progressive MP4 that already carries audio (GraphQL / page metadata). Just stream it through.
  try {
    return await proxyMedia(payload, inline);
  } catch (error) {
    console.warn('Direct video proxy failed:', error.message);
    throw new Error('Could not download the video media.');
  }
}

async function downloadPhoto(payload, inline = false) {
  if (payload.url && isMediaUrl(payload.url)) {
    try {
      return await proxyMedia(payload, inline);
    } catch (error) {
      console.warn('Photo proxy failed:', error.message);
      throw new Error('Could not download the photo media.');
    }
  }
  throw new Error('Missing media URL.');
}

function brandedFilename(payload, contentType) {
  const kind = payload.kind === 'audio' ? 'audio' : payload.kind === 'video' ? 'video' : 'photo';
  const extension = extensionFor(contentType, kind);
  if (kind === 'video') return `ReelsDl.net-${randomUUID().slice(0, 8)}.${extension}`;
  return `ReelsDl-${kind}-${Number(payload.index || 0) + 1}.${extension}`;
}

function fileResponse(downloaded, payload, fallbackType, inline) {
  const stream = createReadStream(downloaded.filePath);
  const cleanup = () => rmSync(downloaded.dir, { recursive: true, force: true });
  stream.on('close', cleanup);
  stream.on('error', cleanup);
  const contentType = fallbackType;
  const filename = brandedFilename(payload, contentType);
  return new Response(Readable.toWeb(stream), {
    headers: {
      'content-type': contentType,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      ...apiResponseHeaders(apiRequest.getStore())
    }
  });
}

async function proxyMedia(payload, inline = false) {
  if (!payload.url || payload.url.startsWith('/')) throw new Error('Missing media URL.');
  const mediaUrl = new URL(payload.url);
  if (!isAllowedMediaHost(mediaUrl.hostname)) throw new Error('Untrusted media host.');
  const response = await safeFetch(mediaUrl, isAllowedMediaHost, { headers: mediaHeaders(), maxRedirects: 3 });
  if (!response.ok || !response.body) throw new Error(`Media server responded with ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > MAX_MEDIA_BYTES) throw new Error('Media file is too large.');
  let contentType = cleanContentType(response.headers.get('content-type'))
    || (payload.kind === 'audio' ? 'audio/mpeg' : payload.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  if (inline && payload.kind === 'audio' && contentType === 'video/mp4') contentType = 'audio/mp4';
  const filename = brandedFilename(payload, contentType);
  return new Response(response.body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      ...apiResponseHeaders(apiRequest.getStore())
    }
  });
}

async function fetchPublicPost(url) {
  const failures = [];
  const started = Date.now();

  const storyInfo = parseStoryPath(url.pathname);
  if (storyInfo) {
    try {
      const storyResult = await fetchStoryMedia(url, storyInfo);
      if (storyResult.media.length) {
        noteInstagramSuccess();
        console.info(`Instagram resolver: story ok in ${Date.now() - started}ms (${storyResult.media.length} item(s))`);
        return storyResult;
      }
    } catch (error) {
      console.warn('Instagram resolver: story API unavailable:', error.message);
      stopIfHardBlock(error, failures, 'story');
    }
    throw new Error(failures.join(' | ') || 'No publicly available story media was found. The story may have expired, or the account may be private.');
  }

  if (parseAudioPath(url.pathname)) {
    try {
      const audio = await fetchWithClipsMusic(url);
      if (audio.media.length) {
        noteInstagramSuccess();
        console.info(`Instagram resolver: clips/music ok in ${Date.now() - started}ms`);
        return audio;
      }
    } catch (error) {
      console.warn('Instagram resolver: audio page unavailable:', error.message);
      stopIfHardBlock(error, failures, 'audio');
    }
    throw new Error(failures.join(' | ') || 'No publicly available audio was found.');
  }

  // Logged-in cookies unlock the web media-info endpoint; try it first when present.
  // Mobile app media-info does not need a www.instagram.com HTML session, so it runs
  // before GraphQL — a login wall on the web session must not block it.
  let best = null;
  const extractors = [];
  if (hasSessionid()) extractors.push(['media-info', fetchWithMediaInfo]);
  extractors.push(
    ['mobile-info', fetchWithMobileMediaInfo],
    ['graphql', fetchWithGraphQL]
  );
  if (!hasSessionid()) extractors.push(['media-info', fetchWithMediaInfo]);
  extractors.push(['ajax-json', fetchWithAjaxJson]);

  for (const [label, extractor] of extractors) {
    const result = await tryPostExtractor(extractor, url, failures, label, best, started);
    best = result.best;
    if (result.complete) return result.complete;
  }

  // Public HTML / embed metadata (cheap, works when Instagram still inlines post JSON).
  const htmlResults = await Promise.allSettled([fetchPageMetadata(url), fetchEmbedMetadata(url)]);
  const htmlParsed = htmlResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((value) => value.media?.length);
  if (htmlParsed.length) {
    best = richerParsed(best, pickBestParsed(htmlParsed));
    if (best?.media?.length && !isIncompleteCarousel(best)) {
      noteInstagramSuccess();
      console.info(`Instagram resolver: html ok in ${Date.now() - started}ms`);
      return best;
    }
  }
  for (const result of htmlResults) {
    if (result.status === 'rejected') {
      stopIfHardBlock(result.reason || new Error('Unknown extractor failure'), failures, 'html');
    }
  }

  if (best?.media?.length) {
    noteInstagramSuccess();
    console.info(`Instagram resolver: using best partial result (${best.media.length} item(s)) in ${Date.now() - started}ms`);
    return best;
  }
  throw new Error(failures.join(' | ') || 'No publicly available media was found.');
}

// --- Direct (no yt-dlp) extractor -------------------------------------------------------------
// Guest path: homepage LSD + first-visit cookies, then GraphQL / media-info / embed.
// When INSTAGRAM_COOKIES includes a sessionid, media-info is tried first (logged-in web API).

const IG_BASE = 'https://www.instagram.com';
const GRAPHQL_ENDPOINT = `${IG_BASE}/api/graphql`;
const GRAPHQL_QUERY_ENDPOINT = `${IG_BASE}/graphql/query`;
const GRAPHQL_APP_ID = '936619743392459';
const GRAPHQL_TIMEOUT_MS = 8_000;
const GRAPHQL_QUERY_NAME = 'PolarisLoggedOutDesktopWWWPostRootContentQuery';
const SHORTCODE_GRAPHQL_QUERY_NAME = 'PolarisPostActionLoadPostQueryQuery';
const DEFAULT_GRAPHQL_DOC_IDS = ['27130156389949648'];
const DEFAULT_SHORTCODE_GRAPHQL_DOC_IDS = ['24368985919464652', '8845758582119845'];
const SESSION_TTL_MS = 10 * 60 * 1000;
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let igSession = null; // { lsd, csrf, expiresAt }

function graphqlDocIds() {
  const configured = String(process.env.INSTAGRAM_GRAPHQL_DOC_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_GRAPHQL_DOC_IDS])];
}

function shortcodeGraphqlDocIds() {
  const configured = String(process.env.INSTAGRAM_GRAPHQL_SHORTCODE_DOC_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_SHORTCODE_GRAPHQL_DOC_IDS])];
}

async function tryPostExtractor(extractor, url, failures, label, best, started) {
  try {
    const parsed = await extractor(url);
    const next = richerParsed(best, parsed);
    if (parsed.media.length && !isIncompleteCarousel(parsed)) {
      noteInstagramSuccess();
      console.info(`Instagram resolver: ${label} ok in ${Date.now() - started}ms (${parsed.media.length} item(s))`);
      return { complete: parsed, best: next };
    }
    if (parsed.media.length) {
      console.warn(`Instagram resolver: ${label} returned ${parsed.media.length}/${parsed.expectedCount || '?'} carousel items, trying other extractors`);
    }
    return { complete: null, best: next };
  } catch (error) {
    console.warn(`Instagram resolver: ${label} unavailable:`, error.message);
    stopIfHardBlock(error, failures, label);
    return { complete: null, best };
  }
}

const POST_KINDS = new Set(['p', 'reel', 'reels', 'tv']);
const IG_APP_UA = 'Instagram 192.168.1.2.116 Android (30/11; 420dpi; 1080x2400; google; Pixel 5; reddfin; reddfin; en_US; 458229237)';
const IG_MOBILE_APP_ID = '567067343352427';
const CLIPS_MUSIC_ENDPOINT = 'https://i.instagram.com/api/v1/clips/music/';

function parseAudioPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const first = parts[0].toLowerCase();
  const second = parts[1].toLowerCase();
  const audioId = parts[2];
  if ((first === 'reels' || first === 'reel') && second === 'audio' && /^\d{6,30}$/.test(audioId)) {
    return { audioId };
  }
  return null;
}

function canonicalizeAudioUrl(url) {
  const parsed = parseAudioPath(url.pathname);
  if (!parsed) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = 'www.instagram.com';
  canonical.pathname = `/reels/audio/${parsed.audioId}/`;
  canonical.search = '';
  canonical.hash = '';
  return canonical;
}

function parsePostPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].toLowerCase();
  const second = (parts[1] || '').toLowerCase();
  if ((first === 'reels' || first === 'reel') && second === 'audio') return null;
  if (first === 'stories') return null;
  if (POST_KINDS.has(first) && parts[1]) {
    return { kind: first === 'reels' ? 'reel' : first, shortcode: parts[1] };
  }
  if (first === 'share' && POST_KINDS.has(second) && parts[2]) {
    return { kind: second === 'reels' ? 'reel' : second, shortcode: parts[2] };
  }
  // Profile-prefixed links: /ciara/p/DcvjhliEcc4/
  if (POST_KINDS.has(second) && parts[2] && !POST_KINDS.has(first) && first !== 'share') {
    return { kind: second === 'reels' ? 'reel' : second, shortcode: parts[2] };
  }
  return null;
}

const SHARE_QUERY_KEYS = ['stkn', 'igsh', 'igshid'];

function applyShareQuery(from, to) {
  for (const key of SHARE_QUERY_KEYS) {
    const value = from.searchParams.get(key);
    if (value) to.searchParams.set(key, value);
  }
  return to;
}

function canonicalizePostUrl(url) {
  const parsed = parsePostPath(url.pathname);
  if (!parsed || !/^[A-Za-z0-9_-]{5,60}$/.test(parsed.shortcode)) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = 'www.instagram.com';
  canonical.pathname = `/${parsed.kind}/${parsed.shortcode}/`;
  canonical.search = '';
  canonical.hash = '';
  return applyShareQuery(url, canonical);
}

function parseStoryPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== 'stories') return null;
  // /stories/highlights/{highlightId}/
  if (parts.length >= 3 && parts[1].toLowerCase() === 'highlights' && /^\d{6,30}$/.test(parts[2])) {
    return { highlightId: parts[2] };
  }
  // /stories/{username}/{storyId}/ or /stories/{username}/
  if (parts.length >= 2 && /^[A-Za-z0-9._]{1,30}$/.test(parts[1])) {
    const storyId = parts[2] && /^\d{6,30}$/.test(parts[2]) ? parts[2] : null;
    return { username: parts[1], storyId };
  }
  return null;
}

function canonicalizeStoryUrl(url) {
  const parsed = parseStoryPath(url.pathname);
  if (!parsed) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = 'www.instagram.com';
  if (parsed.highlightId) {
    canonical.pathname = `/stories/highlights/${parsed.highlightId}/`;
  } else if (parsed.storyId) {
    canonical.pathname = `/stories/${parsed.username}/${parsed.storyId}/`;
  } else {
    canonical.pathname = `/stories/${parsed.username}/`;
  }
  canonical.search = '';
  canonical.hash = '';
  return canonical;
}

function shortcodeFromUrl(url) {
  return parsePostPath(url.pathname)?.shortcode || null;
}

function shortcodeToMediaId(shortcode) {
  // Private posts append 28 extra characters to the public shortcode.
  const code = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
  let value = 0n;
  for (const character of code) {
    const digit = SHORTCODE_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Invalid Instagram shortcode.');
    value = value * 64n + BigInt(digit);
  }
  return value.toString();
}

function apiHeaders(extra = {}) {
  return {
    'user-agent': pageHeaders()['user-agent'],
    'accept-language': pageHeaders()['accept-language'],
    accept: '*/*',
    origin: IG_BASE,
    'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-ig-app-id': GRAPHQL_APP_ID,
    'x-asbd-id': '359341',
    'x-ig-www-claim': '0',
    'x-requested-with': 'XMLHttpRequest',
    ...extra
  };
}

function setCookiesOf(response) {
  return typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
}

function mergeCookies(jar, setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (value === '' || value === '""') jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

let configuredCookiesCache = null;

function configuredCookieJar() {
  if (configuredCookiesCache) return new Map(configuredCookiesCache);
  const jar = new Map();
  const file = process.env.INSTAGRAM_COOKIES_FILE;
  if (file && existsSync(file)) mergeCookieText(jar, readFileSync(file, 'utf8'));
  else if (process.env.INSTAGRAM_COOKIES) mergeCookieText(jar, process.env.INSTAGRAM_COOKIES);
  configuredCookiesCache = jar;
  return new Map(jar);
}

function hasSessionid() {
  return Boolean(configuredCookieJar().get('sessionid'));
}

function mergeCookieText(jar, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return jar;
  const netscapeLine = trimmed.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
  if (netscapeLine && netscapeLine.includes('\t') && netscapeLine.split('\t').length >= 7) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length < 7) continue;
      const name = parts[5]?.trim();
      const value = parts[6]?.trim();
      if (name && value) jar.set(name, value);
    }
    return jar;
  }
  for (const pair of trimmed.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name && value && value !== '""') jar.set(name, value);
  }
  return jar;
}

async function getInstagramSession(shortcode) {
  if (igSession && igSession.expiresAt > Date.now()) return igSession;

  const jar = configuredCookieJar();
  const cookie = cookieHeader(jar);
  const response = await fetch(`${IG_BASE}/`, {
    headers: {
      ...pageHeaders(),
      ...(cookie ? { cookie } : {})
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
  });
  const finalUrl = new URL(response.url);
  if (!isInstagramHost(finalUrl.hostname)) throw new Error('Unexpected redirect while starting an Instagram session.');
  const html = await response.text();
  mergeCookies(jar, setCookiesOf(response));

  const eqmc = html.match(/<script\b[^>]*\bid="__eqmc"[^>]*>(\{.*?\})<\/script>/s);
  let lsd = null;
  if (eqmc) {
    try { lsd = JSON.parse(eqmc[1]).l || null; } catch { /* fall through to regex */ }
  }
  if (!lsd) lsd = html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1] || null;
  if (!lsd && shortcode) {
    const postResponse = await fetch(`${IG_BASE}/p/${shortcode}/`, {
      headers: {
        ...pageHeaders(),
        ...(cookie ? { cookie } : {})
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
    });
    mergeCookies(jar, setCookiesOf(postResponse));
    const postHtml = await postResponse.text();
    const postEqmc = postHtml.match(/<script\b[^>]*\bid="__eqmc"[^>]*>(\{.*?\})<\/script>/s);
    if (postEqmc) {
      try { lsd = JSON.parse(postEqmc[1]).l || null; } catch { /* ignore */ }
    }
    if (!lsd) lsd = postHtml.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1] || null;
  }
  if (!lsd) throw new Error('Could not find an Instagram LSD token.');

  const loginWall = /^\/accounts\/login/.test(finalUrl.pathname);
  igSession = {
    lsd,
    jar,
    expiresAt: Date.now() + (loginWall && !jar.get('sessionid') ? 30_000 : SESSION_TTL_MS)
  };
  return igSession;
}

async function checkRuling(mediaId, session) {
  // Same call the web client makes before loading a post; also tops up the anonymous cookie jar.
  try {
    const response = await fetch(`${IG_BASE}/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=${mediaId}`, {
      headers: apiHeaders({ cookie: cookieHeader(session.jar), referer: `${IG_BASE}/` }),
      redirect: 'manual',
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
    });
    mergeCookies(session.jar, setCookiesOf(response));
    if (!response.ok) return null;
    return parseMetaJson(await response.text());
  } catch {
    return null;
  }
}

async function fetchWithGraphQL(url) {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode || !/^[A-Za-z0-9_-]{5,60}$/.test(shortcode)) throw new Error('Could not read a post shortcode from that link.');
  const mediaId = shortcodeToMediaId(shortcode);
  const pageUrl = `${IG_BASE}/p/${shortcode}/`;

  const session = await getInstagramSession(shortcode);
  const ruling = await checkRuling(mediaId, session);
  const rulingDetail = [ruling?.title, ruling?.description, ruling?.message].filter(Boolean).join(': ');
  if (/restricted/i.test(rulingDetail)) throw new Error(`Instagram API is not granting access: ${rulingDetail}`);
  const mediaMissing = /cannot be found/i.test(rulingDetail || ruling?.message || '');

  const attempts = [
    ...graphqlDocIds().map((docId) => ({
      docId,
      name: GRAPHQL_QUERY_NAME,
      variables: { media_id: mediaId }
    })),
    ...shortcodeGraphqlDocIds().map((docId) => ({
      docId,
      name: SHORTCODE_GRAPHQL_QUERY_NAME,
      variables: {
        shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null
      }
    }))
  ];

  const errors = [];
  if (mediaMissing) errors.push(ruling.message || 'Media cannot be found');
  const endpoints = [GRAPHQL_QUERY_ENDPOINT, GRAPHQL_ENDPOINT];
  for (const attempt of attempts) {
    for (const endpoint of endpoints) {
      const parsed = await postGraphQL(endpoint, session, pageUrl, attempt, errors);
      if (parsed) return parsed;
    }
  }
  throw new Error(errors.join(' / ') || 'Instagram graphql returned nothing.');
}

async function postGraphQL(endpoint, session, pageUrl, attempt, errors) {
  const body = new URLSearchParams({
    lsd: session.lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: attempt.name,
    server_timestamps: 'true',
    variables: JSON.stringify(attempt.variables),
    doc_id: attempt.docId
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: apiHeaders({
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': attempt.name,
        'x-fb-lsd': session.lsd,
        ...(session.jar.get('csrftoken') ? { 'x-csrftoken': session.jar.get('csrftoken') } : {}),
        cookie: cookieHeader(session.jar),
        referer: pageUrl
      }),
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
    });
  } catch (error) {
    errors.push(`${endpoint} doc ${attempt.docId}: ${error.message}`);
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    igSession = null;
    errors.push(`${endpoint} doc ${attempt.docId}: HTTP ${response.status}`);
    return null;
  }
  if (!response.ok) {
    errors.push(`${endpoint} doc ${attempt.docId}: HTTP ${response.status}`);
    return null;
  }

  const raw = await response.text();
  if (!raw || raw.startsWith('<')) {
    errors.push(`${endpoint} doc ${attempt.docId}: HTML response`);
    return null;
  }
  let json;
  try {
    json = parseMetaJson(raw);
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown type';
    errors.push(`${endpoint} doc ${attempt.docId}: non-JSON response (${contentType}; starts "${raw.slice(0, 80).replace(/\s+/g, ' ')}")`);
    return null;
  }

  const product = json?.data?.xig_polaris_media?.if_not_gated_logged_out
    || json?.data?.xdt_shortcode_media
    || json?.data?.shortcode_media;
  if (!product) {
    const message = json?.errors?.[0]?.message
      || (json?.data?.xig_polaris_media ? 'empty media response (post is gated for logged-out viewers)' : 'empty media response');
    errors.push(`${endpoint} doc ${attempt.docId}: ${message}`);
    return null;
  }
  return parseDirectMedia(product, 'graphql');
}

async function fetchWithMediaInfo(url) {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode || !/^[A-Za-z0-9_-]{5,60}$/.test(shortcode)) throw new Error('Could not read a post shortcode from that link.');
  const mediaId = shortcodeToMediaId(shortcode);
  const session = await getInstagramSession(shortcode);
  const response = await fetch(`${IG_BASE}/api/v1/media/${mediaId}/info/`, {
    headers: apiHeaders({
      cookie: cookieHeader(session.jar),
      referer: `${IG_BASE}/p/${shortcode}/`
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
  });
  mergeCookies(session.jar, setCookiesOf(response));
  if (response.status === 401 || response.status === 403) {
    throw new Error('Instagram API is not granting access to this post anonymously.');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = parseMetaJson(await response.text());
  const item = json?.items?.[0];
  if (!item) throw new Error('empty media info response');
  return parseDirectMedia(item, 'media-info');
}

async function fetchWithMobileMediaInfo(url) {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode || !/^[A-Za-z0-9_-]{5,60}$/.test(shortcode)) throw new Error('Could not read a post shortcode from that link.');
  const mediaId = shortcodeToMediaId(shortcode);
  const cookie = cookieHeader(configuredCookieJar());
  const response = await fetch(`${IG_MOBILE_BASE}/api/v1/media/${mediaId}/info/`, {
    headers: {
      ...mobileApiHeaders(),
      ...(cookie ? { cookie } : {}),
      referer: `${IG_BASE}/`
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Instagram mobile API is not granting access to this post anonymously.');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram mobile API returned a non-JSON response.');
  const json = parseMetaJson(raw);
  const item = json?.items?.[0];
  if (!item) throw new Error('empty mobile media info response');
  return parseDirectMedia(item, 'mobile-info');
}

async function fetchWithAjaxJson(url) {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode || !/^[A-Za-z0-9_-]{5,60}$/.test(shortcode)) throw new Error('Could not read a post shortcode from that link.');
  const cookie = cookieHeader(configuredCookieJar());
  const ajaxUrl = `${IG_BASE}/p/${shortcode}/?__a=1&__d=dis`;
  const response = await fetch(ajaxUrl, {
    headers: apiHeaders({
      ...(cookie ? { cookie } : {}),
      ...(configuredCookieJar().get('csrftoken') ? { 'x-csrftoken': configuredCookieJar().get('csrftoken') } : {}),
      referer: `${IG_BASE}/p/${shortcode}/`
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Instagram ajax endpoint is not granting access to this post anonymously.');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram ajax endpoint returned HTML instead of JSON.');
  const json = parseMetaJson(raw);
  const product = json?.items?.[0]
    || json?.graphql?.shortcode_media
    || json?.data?.xdt_shortcode_media
    || json?.data?.shortcode_media;
  if (!product) throw new Error('empty ajax media response');
  return parseDirectMedia(product, 'ajax-json');
}

function parseMetaJson(raw) {
  // Meta APIs prefix JSON with an anti-hijacking guard such as `for (;;);`.
  const trimmed = raw.replace(/^\s*for\s*\(;;\);?/, '').trim();
  return JSON.parse(trimmed);
}

function parseDirectMedia(product, source = 'graphql') {
  const media = [];
  collectInstagramMedia(product, media);
  const username = product.user?.username || product.owner?.username;
  const caption = String(product.caption?.text || product.edge_media_to_caption?.edges?.[0]?.node?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const isCarousel = Array.isArray(product.carousel_media) || Boolean(product.edge_sidecar_to_children);
  const isVideo = product.media_type === 2 || product.is_video || /video/i.test(product.__typename || '');
  const kindLabel = isCarousel ? 'Post' : isVideo ? 'Video' : 'Photo';
  let title = username ? `${kindLabel} by ${username}` : 'Public Instagram post';
  if (caption) title = `${title} — ${caption.length > 90 ? `${caption.slice(0, 87)}…` : caption}`;
  return {
    title,
    username: sanitizeUsername(username),
    caption,
    media: limitMedia(media),
    expectedCount: carouselExpectedCount(product),
    source
  };
}

function carouselExpectedCount(product) {
  const counts = [
    product?.carousel_media_count,
    product?.carousel_count,
    product?.edge_sidecar_to_children?.count,
    product?.edge_sidecar_to_children?.edges?.length,
    Array.isArray(product?.carousel_media) ? product.carousel_media.length : 0
  ].map((value) => Number(value) || 0);
  return Math.max(0, ...counts);
}

function isIncompleteCarousel(parsed) {
  return Number(parsed?.expectedCount || 0) > (parsed?.media?.length || 0);
}

async function attachDashAudioFromMediaInfo(parsed, url) {
  const videos = (parsed?.media || []).filter((item) => item.type === 'video');
  if (!videos.length || videos.every((item) => item.audioUrl && isMediaUrl(item.audioUrl))) return parsed;
  try {
    const info = await fetchWithMediaInfo(url);
    mergeStandaloneAudio(parsed, info);
  } catch (error) {
    console.warn('Instagram resolver: dash audio lookup failed:', error.message);
  }
  return parsed;
}

function mergeStandaloneAudio(parsed, extra) {
  const extraVideos = (extra?.media || []).filter((item) => item.type === 'video' && item.audioUrl && isMediaUrl(item.audioUrl));
  if (!extraVideos.length) return parsed;
  const byPk = new Map(extraVideos.filter((item) => item.pk).map((item) => [String(item.pk), item]));
  let index = 0;
  for (const item of parsed.media || []) {
    if (item.type !== 'video') continue;
    const match = (item.pk && byPk.get(String(item.pk))) || extraVideos[index] || null;
    index += 1;
    if (!match?.audioUrl || !isMediaUrl(match.audioUrl)) continue;
    item.audioUrl = match.audioUrl;
    item.hasAudio = true;
  }
  return parsed;
}

async function lookupStandaloneAudio(payload) {
  const existing = payload.audioUrl && isMediaUrl(payload.audioUrl) && payload.audioUrl !== payload.url
    ? payload.audioUrl
    : null;
  if (existing) return existing;
  if (!payload.pageUrl) return null;
  try {
    const info = await fetchWithMediaInfo(validateInstagramUrl(payload.pageUrl));
    const items = info.media || [];
    const index = Number(payload.index);
    const atIndex = Number.isFinite(index) && index >= 0 ? items[index] : null;
    if (atIndex?.audioUrl && isMediaUrl(atIndex.audioUrl)) return atIndex.audioUrl;
    const videos = items.filter((item) => item.type === 'video');
    const match = videos.find((item) => item.sourceUrl === payload.url)
      || (videos.length === 1 ? videos[0] : null);
    return match?.audioUrl && isMediaUrl(match.audioUrl) ? match.audioUrl : null;
  } catch (error) {
    console.warn('DASH audio lookup failed:', error.message);
    return null;
  }
}

function richerParsed(current, next) {
  if (!next?.media?.length) return current;
  if (!current?.media?.length) return next;
  const winner = scoreParsed(next) > scoreParsed(current) ? next : current;
  return {
    ...winner,
    expectedCount: Math.max(Number(current.expectedCount || 0), Number(next.expectedCount || 0))
  };
}

function sanitizeUsername(value) {
  const raw = String(value || '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(raw) ? raw : null;
}

function identityFromTitle(title, description = '') {
  const text = String(title || '');
  const byMatch = text.match(/^(?:Video|Photo|Post|Reel|Audio)s? by ([A-Za-z0-9._]+)/i);
  const onMatch = text.match(/^([A-Za-z0-9._]+) on Instagram:\s*[“"']?([\s\S]+)/i);
  const dashMatch = text.match(/^(?:Video|Photo|Post|Reel)s? by ([A-Za-z0-9._]+)\s+[—–-]\s+([\s\S]+)/i);
  const username = sanitizeUsername(dashMatch?.[1] || byMatch?.[1] || onMatch?.[1]);
  const caption = String(dashMatch?.[2] || onMatch?.[2] || description || '')
    .replace(/\s+/g, ' ')
    .replace(/[…]+$/, '')
    .trim();
  return { username, caption };
}

function postIdentity(parsed) {
  const fromFields = {
    username: sanitizeUsername(parsed.username),
    caption: String(parsed.caption || '').replace(/\s+/g, ' ').trim()
  };
  const fromTitle = identityFromTitle(parsed.title, fromFields.caption);
  const username = fromFields.username || fromTitle.username;
  const caption = fromFields.caption || fromTitle.caption || '';
  return {
    title: parsed.title || (username ? `@${username}` : 'Public Instagram post'),
    username,
    caption,
    profileUrl: username ? `https://www.instagram.com/${username}/` : null
  };
}

function pickBestParsed(parsed) {
  const titled = parsed.find((item) => item.title && item.title !== 'Public Instagram post');
  const best = [...parsed].sort((a, b) => scoreParsed(b) - scoreParsed(a))[0];
  return {
    title: titled?.title || best.title,
    username: titled?.username || best.username || null,
    caption: titled?.caption || best.caption || '',
    media: best.media
  };
}

function scoreParsed(parsed) {
  const photos = parsed.media.filter((item) => item.type === 'photo').length;
  const videos = parsed.media.filter((item) => item.type === 'video').length;
  return parsed.media.length * 100 + videos * 15 + photos * 10;
}

async function fetchPageMetadata(url) {
  const response = await safeFetch(url, isInstagramHost, { headers: htmlPageHeaders(), maxRedirects: 4 });
  if (!response.ok) throw new Error(`Instagram returned ${response.status}.`);
  const html = await response.text();
  if (html.length < 250) throw new Error('Instagram returned an incomplete page.');
  const parsed = parsePublicMedia(html);
  if (!parsed.media.length) throw new Error('No publicly available media was found.');
  const kind = parsePostPath(url.pathname)?.kind;
  if ((kind === 'reel' || kind === 'reels' || kind === 'tv') && !parsed.media.some((item) => item.type === 'video')) {
    throw new Error('No publicly available media was found.');
  }
  return parsed;
}

async function fetchEmbedMetadata(url) {
  const errors = [];
  for (const embedUrl of embedUrlsFor(url)) {
    try {
      const response = await safeFetch(embedUrl, isInstagramHost, { headers: htmlPageHeaders(), maxRedirects: 4 });
      if (!response.ok) {
        errors.push(`${embedUrl.pathname}: HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      if (html.length < 250) {
        errors.push(`${embedUrl.pathname}: incomplete embed`);
        continue;
      }
      const parsed = parsePublicMedia(html);
      if (parsed.media.length) return parsed;
      errors.push(`${embedUrl.pathname}: no media`);
    } catch (error) {
      errors.push(`${embedUrl.pathname}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' / ') || 'No publicly available media was found in the embed.');
}

function isVideoFileUrl(value) {
  return /\.(mp4|webm|mov|mkv)(\?|$)/i.test(value);
}

function isLowResImage(value) {
  return /s150x150|s240x240|s320x320|s60x60|p150x150|p240x240/i.test(value);
}

function dedupeMedia(media) {
  const seen = new Set();
  return media.filter((item) => {
    if (seen.has(item.sourceUrl)) return false;
    seen.add(item.sourceUrl);
    return true;
  });
}

function limitMedia(media) {
  return dedupeMedia(media).slice(0, MAX_POST_MEDIA);
}

async function followInstagramRedirect(url) {
  const audio = canonicalizeAudioUrl(url);
  if (audio) return audio;
  const story = canonicalizeStoryUrl(url);
  if (story) return story;
  // Canonical post links (including /username/p/shortcode) need no extra hop.
  const alreadyCanonical = canonicalizePostUrl(url);
  if (alreadyCanonical) return alreadyCanonical;
  const response = await safeFetch(url, isInstagramHost, { headers: htmlPageHeaders(), maxRedirects: 4 });
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    if (response.status === 429) noteInstagramFailure();
    throw new Error(`Instagram returned ${response.status}.`);
  }
  try {
    const finalUrl = new URL(response.url);
    const normalized = canonicalizePostUrl(finalUrl);
    if (normalized) return normalized;
    const audioRedirect = canonicalizeAudioUrl(finalUrl);
    if (audioRedirect) return audioRedirect;
    const storyRedirect = canonicalizeStoryUrl(finalUrl);
    if (storyRedirect) return storyRedirect;
    if (isSupportedInstagramPath(finalUrl.pathname)) return finalUrl;
  } catch {
    // Keep the submitted post URL when Instagram bounces to login.
  }
  if (isSupportedInstagramPath(url.pathname)) return canonicalizePostUrl(url) || canonicalizeAudioUrl(url) || canonicalizeStoryUrl(url) || url;
  throw new Error('That link did not resolve to a public Instagram reel, post, story, or audio page.');
}

function parsePublicMedia(html) {
  const metas = getMetaTags(html);
  const title = decodeHtml(metas.get('og:title') || metas.get('twitter:title') || 'Public Instagram post')
    .replace(/\s*•\s*Instagram.*$/i, '').trim() || 'Public Instagram post';
  const description = decodeHtml(metas.get('og:description') || metas.get('twitter:description') || '')
    .replace(/\s+/g, ' ')
    .trim();
  const identity = identityFromTitle(title, description);
  const walked = extractMediaFromHtml(html);
  if (walked.length) {
    return { title, ...identity, media: limitMedia(walked), source: 'html' };
  }

  const videoUrls = uniqueUrls([
    metas.get('og:video:secure_url'), metas.get('og:video'), metas.get('twitter:player:stream'),
    ...getJsonStringValues(html, ['video_url', 'videoUrl', 'contentUrl'])
  ]).filter(isMediaUrl);
  const photoUrls = uniqueUrls([
    metas.get('og:image:secure_url'), metas.get('og:image'), metas.get('twitter:image'),
    ...getJsonStringValues(html, ['display_url', 'displayUrl', 'thumbnail_src', 'image_url', 'imageUrl'])
  ]).filter((url) => isMediaUrl(url) && !isLowResImage(url));
  const media = [];
  const used = new Set();
  for (const sourceUrl of videoUrls.slice(0, MAX_POST_MEDIA)) {
    used.add(sourceUrl);
    media.push({ type: 'video', sourceUrl, previewUrl: photoUrls[0] || sourceUrl, hasAudio: true });
  }
  for (const sourceUrl of photoUrls.slice(0, MAX_POST_MEDIA)) {
    if (used.has(sourceUrl)) continue;
    media.push({ type: 'photo', sourceUrl, previewUrl: sourceUrl, hasAudio: false });
  }
  return { title, ...identity, media: limitMedia(media), source: 'html' };
}

function toEmbedUrl(url) {
  const embed = new URL(url.toString());
  const parts = embed.pathname.split('/').filter(Boolean);
  if (parts.includes('embed')) {
    embed.search = '';
    embed.hash = '';
    return embed;
  }
  if (parts[0] === 'share' && parts[1] && parts[2]) embed.pathname = `/${parts[1]}/${parts[2]}/embed/`;
  else if (parts[0] && parts[1]) embed.pathname = `/${parts[0]}/${parts[1]}/embed/`;
  else embed.pathname = `${embed.pathname.replace(/\/+$/, '')}/embed/`;
  embed.search = '';
  embed.hash = '';
  return embed;
}

function embedUrlsFor(url) {
  const embed = toEmbedUrl(url);
  const captioned = new URL(embed.toString());
  captioned.pathname = embed.pathname.replace(/\/embed\/?$/, '/embed/captioned/');
  if (captioned.pathname === embed.pathname) return [embed];
  return [captioned, embed];
}

function extractMediaFromHtml(html) {
  const media = [];
  for (const blob of extractJsonBlobs(html)) collectInstagramMedia(blob, media);
  for (const match of html.matchAll(/<(?:img|image|video|source)[^>]+(?:src|content)=["'](https:[^"']+)["']/gi)) {
    const sourceUrl = decodeHtml(match[1]);
    if (!isMediaUrl(sourceUrl) || isLowResImage(sourceUrl)) continue;
    const isVideo = /<video|<source/i.test(match[0]) || isVideoFileUrl(sourceUrl);
    media.push(isVideo
      ? { type: 'video', sourceUrl, previewUrl: sourceUrl, hasAudio: true }
      : { type: 'photo', sourceUrl, previewUrl: sourceUrl, hasAudio: false });
  }
  return dedupeMedia(media);
}

function extractJsonBlobs(html) {
  const blobs = [];
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (blobs.length >= 24) break;
    const text = match[1].trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (!text) continue;
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        blobs.push(JSON.parse(text));
        continue;
      } catch {
        // Instagram often wraps JSON in JS calls.
      }
    }
    for (const jsonMatch of text.matchAll(/\{(?:"require"|'require'|"(?:xdt_|gql_|shortcode_media|items|entry_data))/g)) {
      const slice = extractBalancedJson(text, jsonMatch.index);
      if (!slice) continue;
      try { blobs.push(JSON.parse(slice)); } catch { /* ignore incomplete JSON islands */ }
      if (blobs.length >= 24) break;
    }
  }
  return blobs;
}

function extractBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function collectInstagramMedia(value, media, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 14) return;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => isInstagramMediaNode(item))) {
      for (const item of value) {
        const parsed = mediaFromInstagramNode(item);
        if (parsed) media.push(parsed);
      }
      return;
    }
    for (const item of value) collectInstagramMedia(item, media, depth + 1);
    return;
  }
  if (Array.isArray(value.edge_sidecar_to_children?.edges)) {
    for (const edge of value.edge_sidecar_to_children.edges) {
      const parsed = mediaFromInstagramNode(edge?.node);
      if (parsed) media.push(parsed);
    }
    return;
  }
  if (Array.isArray(value.carousel_media)) {
    for (const item of value.carousel_media) {
      const parsed = mediaFromInstagramNode(item);
      if (parsed) media.push(parsed);
    }
    return;
  }
  if (isInstagramMediaNode(value)) {
    const parsed = mediaFromInstagramNode(value);
    if (parsed) media.push(parsed);
    return;
  }
  if (value['@type'] === 'ImageObject' && isMediaUrl(value.contentUrl)) {
    media.push({ type: 'photo', sourceUrl: value.contentUrl, previewUrl: value.contentUrl, hasAudio: false });
  }
  if (value['@type'] === 'VideoObject' && isMediaUrl(value.contentUrl)) {
    media.push({ type: 'video', sourceUrl: value.contentUrl, previewUrl: value.thumbnailUrl || value.contentUrl, hasAudio: true });
  }
  for (const [key, child] of Object.entries(value)) {
    if (SKIP_WALK_KEYS.has(key)) continue;
    collectInstagramMedia(child, media, depth + 1);
  }
}

function isInstagramMediaNode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    value.image_versions2
    || value.video_versions
    || value.video_url
    || value.videoUrl
    || value.display_url
    || value.displayUrl
    || ('is_video' in value && (value.original_width || value.original_height || value.pk || value.id))
  );
}

function mediaFromInstagramNode(node) {
  if (!node) return null;
  const bestVideoVersions = [...(node.video_versions || [])]
    .filter((version) => version?.url)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))
    .map((version) => version.url);
  const videoUrl = firstMediaUrl([
    node.video_url,
    node.videoUrl,
    ...bestVideoVersions
  ]);
  const largestResource = [...(node.display_resources || [])]
    .filter((resource) => resource?.src)
    .sort((a, b) => (b.config_width || 0) * (b.config_height || 0) - (a.config_width || 0) * (a.config_height || 0))[0]?.src;
  const largestCandidate = [...(node.image_versions2?.candidates || [])]
    .filter((candidate) => candidate?.url)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))
    .map((candidate) => candidate.url);
  const photoUrl = firstMediaUrl([
    largestResource,
    node.display_url,
    node.displayUrl,
    ...largestCandidate,
    node.thumbnail_src,
    node.thumbnail_url,
    node.thumbnailUrl
  ].filter((url) => !isLowResImage(String(url || ''))));
  if (node.is_video || node.media_type === 2 || videoUrl) {
    if (!videoUrl) return photoUrl ? { type: 'photo', sourceUrl: photoUrl, previewUrl: photoUrl, hasAudio: false } : null;
    const dashAudioUrl = audioUrlFromDashManifest(
      node.video_dash_manifest
      || node.dash_manifest
      || node.video_dash_manifest_adaptive
      || node.dash_info?.video_dash_manifest
    );
    const audioUrl = firstMediaUrl([
      node.audio_url,
      dashAudioUrl,
      node.music_metadata?.audio_asset_info?.progressive_download_url,
      node.clips_metadata?.original_sound_info?.progressive_download_url,
      node.clips_metadata?.music_info?.music_asset_info?.progressive_download_url
    ]) || null;
    const hasAudioFlag = node.has_audio;
    const hasMusicMeta = Boolean(
      audioUrl
      || node.clips_metadata?.original_sound_info
      || node.clips_metadata?.music_info
      || node.music_metadata
    );
    let hasAudio = true;
    if (audioUrl) hasAudio = true;
    else if (hasAudioFlag === false || hasAudioFlag === 0) hasAudio = false;
    else if (hasAudioFlag === true || hasAudioFlag === 1 || hasMusicMeta) hasAudio = true;
    return {
      type: 'video',
      sourceUrl: videoUrl,
      previewUrl: photoUrl || videoUrl,
      hasAudio,
      audioUrl,
      pk: node.pk || node.id || null
    };
  }
  if (!photoUrl) return null;
  return { type: 'photo', sourceUrl: photoUrl, previewUrl: photoUrl, hasAudio: false };
}

function firstMediaUrl(values) {
  return values.find(isMediaUrl);
}

function audioUrlFromDashManifest(xml) {
  if (!xml || typeof xml !== 'string') return null;
  const decoded = decodeHtml(xml);
  const sets = [...decoded.matchAll(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/gi)]
    .map((match) => match[0])
    .filter((block) => /contentType="audio"|mimeType="audio/i.test(block));
  const blocks = sets.length ? sets : [decoded];
  const urls = [];
  for (const block of blocks) {
    for (const match of block.matchAll(/<Representation\b[^>]*>[\s\S]*?<\/Representation>/gi)) {
      const representation = match[0];
      const bandwidth = Number(/bandwidth="(\d+)"/i.exec(representation)?.[1] || 0);
      const base = /<BaseURL>\s*([^<]+?)\s*<\/BaseURL>/i.exec(representation)?.[1];
      const url = base ? decodeHtml(base).trim() : '';
      if (isMediaUrl(url)) urls.push({ bandwidth, url });
    }
  }
  urls.sort((a, b) => b.bandwidth - a.bandwidth);
  return urls[0]?.url || null;
}

function getMetaTags(html) {
  const tags = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const [, name, quote, value] of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) {
      attributes[name.toLowerCase()] = decodeHtml(value);
    }
    const key = (attributes.property || attributes.name || '').toLowerCase();
    if (key && attributes.content && !tags.has(key)) tags.set(key, attributes.content);
  }
  return tags;
}

function getJsonStringValues(html, keys) {
  const values = [];
  for (const key of keys) {
    const expression = new RegExp(`(?:["']${key}["'])\\s*:\\s*["']((?:\\\\.|[^"'])*)["']`, 'gi');
    for (const match of html.matchAll(expression)) {
      const decoded = decodeJsString(match[1]);
      if (decoded) values.push(decoded);
    }
  }
  return values;
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u0025/gi, '%').replace(/&amp;/g, '&');
  }
}

function uniqueUrls(values) {
  const seen = new Set();
  return values.map((value) => decodeHtml(String(value || '')).trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function lightPreviewUrl(item) {
  const candidates = [item.coverUrl, item.previewUrl];
  if (item.type === 'photo') candidates.push(item.sourceUrl);
  for (const url of candidates) {
    if (!url || !isMediaUrl(url) || isVideoFileUrl(url)) continue;
    return url;
  }
  return null;
}

function isMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !isAllowedMediaHost(url.hostname)) return false;
    if (/rsrc\.php|\.css$|\.js$|\/rsrc\//i.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function publicCdnUrl(value) {
  if (!isMediaUrl(value)) return null;
  const url = new URL(value);
  url.searchParams.set('dl', '1');
  return url.toString();
}

function validateInstagramUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete Instagram URL, starting with https://.');
  }
  if (url.protocol !== 'https:' || !isInstagramHost(url.hostname)) throw new Error('Use a link from instagram.com.');
  return url;
}

function isInstagramHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}

function isAllowedMediaHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'static.cdninstagram.com') return false;
  return host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com') || host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
}


function isSupportedPostPath(pathname) {
  return Boolean(parsePostPath(pathname));
}

function isSupportedInstagramPath(pathname) {
  return Boolean(parsePostPath(pathname) || parseAudioPath(pathname) || parseStoryPath(pathname));
}

async function fetchWithClipsMusic(url) {
  const parsed = parseAudioPath(url.pathname);
  if (!parsed) throw new Error('Could not read an audio id from that link.');

  const body = new URLSearchParams({
    audio_cluster_id: parsed.audioId,
    original_sound_audio_asset_id: parsed.audioId,
    tab_type: 'clips'
  });
  const response = await fetch(CLIPS_MUSIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'user-agent': IG_APP_UA,
      accept: '*/*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-ig-app-id': IG_MOBILE_APP_ID
    },
    body: body.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Instagram audio API returned ${response.status}.`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram audio API returned a non-JSON response.');
  const json = parseMetaJson(raw);
  if (json.status && json.status !== 'ok') {
    throw new Error(json.message || 'Instagram did not return that audio page.');
  }
  const extracted = audioFromClipsMusic(json);
  if (!extracted) throw new Error('No downloadable audio file was found on that page.');
  return extracted;
}

const IG_MOBILE_BASE = 'https://i.instagram.com';
const STORY_API_TIMEOUT_MS = 10_000;

function mobileApiHeaders() {
  const headers = {
    'user-agent': IG_APP_UA,
    accept: '*/*',
    'x-ig-app-id': IG_MOBILE_APP_ID
  };
  const cookie = cookieHeader(igSession?.jar || configuredCookieJar());
  if (cookie) headers.cookie = cookie;
  return headers;
}

async function resolveUserId(username) {
  const clean = sanitizeUsername(username);
  if (!clean) throw new Error('Invalid Instagram username.');
  const response = await fetch(`${IG_MOBILE_BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(clean)}`, {
    headers: mobileApiHeaders(),
    redirect: 'manual',
    signal: AbortSignal.timeout(STORY_API_TIMEOUT_MS)
  });
  if (response.status === 404) throw new Error('That Instagram user was not found.');
  if (!response.ok) throw new Error(`Instagram user lookup returned ${response.status}.`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram returned a non-JSON user response.');
  const json = parseMetaJson(raw);
  const userId = json?.data?.user?.id || json?.data?.user?.pk || json?.data?.user?.pk_id;
  if (!userId) throw new Error('Could not resolve that username to a user ID.');
  return String(userId);
}

async function fetchStoryMedia(url, storyInfo) {
  // Highlights: /stories/highlights/{highlightId}/
  if (storyInfo.highlightId) {
    return await fetchHighlightMedia(storyInfo.highlightId);
  }

  // Active stories: /stories/{username}/ or /stories/{username}/{storyId}/
  const username = storyInfo.username;
  const userId = await resolveUserId(username);
  const response = await fetch(`${IG_MOBILE_BASE}/api/v1/feed/user/${userId}/reel_media/`, {
    headers: mobileApiHeaders(),
    redirect: 'manual',
    signal: AbortSignal.timeout(STORY_API_TIMEOUT_MS)
  });
  if (response.status === 404) throw new Error('No active stories were found for this user.');
  if (!response.ok) throw new Error(`Instagram story API returned ${response.status}.`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram story API returned a non-JSON response.');
  const json = parseMetaJson(raw);
  if (json.status && json.status !== 'ok') {
    throw new Error(json.message || 'Instagram did not return story data.');
  }

  const items = json.items || json.reel?.items || [];
  if (!items.length) throw new Error('No active stories were found for this user. The stories may have expired or the account may be private.');

  // If a specific storyId was requested, filter to just that item.
  const filtered = storyInfo.storyId
    ? items.filter((item) => String(item.pk || item.id || '') === storyInfo.storyId)
    : items;
  const targets = filtered.length ? filtered : items;

  const media = [];
  for (const item of targets) {
    const parsed = mediaFromInstagramNode(item);
    if (parsed) media.push(parsed);
  }

  const storyUser = json.user || json.reel?.user || {};
  const resolvedUsername = sanitizeUsername(storyUser.username || username);
  const count = media.length;
  const title = resolvedUsername
    ? `${count === 1 ? 'Story' : 'Stories'} by ${resolvedUsername}`
    : 'Public Instagram story';

  return {
    title,
    username: resolvedUsername,
    caption: '',
    media: limitMedia(media),
    source: 'story-api'
  };
}

async function fetchHighlightMedia(highlightId) {
  const reelId = `highlight:${highlightId}`;
  const body = new URLSearchParams({
    reel_ids: reelId
  });
  const response = await fetch(`${IG_MOBILE_BASE}/api/v1/feed/reels_media/`, {
    method: 'POST',
    headers: {
      ...mobileApiHeaders(),
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: body.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(STORY_API_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Instagram highlights API returned ${response.status}.`);
  const raw = await response.text();
  if (!raw || raw.startsWith('<')) throw new Error('Instagram highlights API returned a non-JSON response.');
  const json = parseMetaJson(raw);
  if (json.status && json.status !== 'ok') {
    throw new Error(json.message || 'Instagram did not return highlight data.');
  }

  const reel = json.reels?.[reelId] || json.reels_media?.[0] || null;
  const items = reel?.items || [];
  if (!items.length) throw new Error('No media was found in this highlight. It may have been removed or the account may be private.');

  const media = [];
  for (const item of items) {
    const parsed = mediaFromInstagramNode(item);
    if (parsed) media.push(parsed);
  }

  const highlightUser = reel?.user || {};
  const username = sanitizeUsername(highlightUser.username);
  const highlightTitle = reel?.title || 'Highlight';
  const title = username
    ? `${highlightTitle} — highlight by ${username}`
    : highlightTitle;

  return {
    title,
    username,
    caption: '',
    media: limitMedia(media),
    source: 'highlight-api'
  };
}

function audioFromClipsMusic(data) {
  const nodes = [
    data?.metadata?.original_sound_info,
    data?.metadata?.music_info?.music_asset_info,
    data?.metadata?.music_info
  ];
  for (const item of data?.items || []) {
    const media = item?.media || item;
    const clips = media?.clips_metadata || {};
    nodes.push(clips.original_sound_info, clips.music_info?.music_asset_info, media?.music_metadata?.music_info?.music_asset_info);
  }
  for (const node of nodes) {
    const audio = audioFromSoundNode(node);
    if (!audio) continue;
    const coverUrl = bestAudioCover(data, audio.media[0]?.coverUrl);
    audio.media[0].coverUrl = coverUrl;
    audio.media[0].previewUrl = coverUrl;
    return audio;
  }
  return null;
}

function audioFromSoundNode(node) {
  if (!node || typeof node !== 'object') return null;
  const sourceUrl = firstMediaUrl([
    node.progressive_download_url,
    node.fast_start_progressive_download_url,
    node.audio_asset_info?.progressive_download_url,
    node.web_30s_preview_download_url
  ]);
  if (!sourceUrl) return null;
  const artist = node.ig_artist || {};
  const username = sanitizeUsername(artist.username || node.display_artist);
  const title = String(node.original_audio_title || node.title || 'Original audio').replace(/\s+/g, ' ').trim();
  const coverUrl = firstImageUrl([
    node.cover_artwork_uri,
    node.cover_artwork_thumbnail_uri,
    artist.profile_pic_url_hd,
    artist.profile_pic_url
  ]);
  return {
    title: username ? `${title} — original audio by ${username}` : title,
    username,
    caption: title,
    media: [{
      type: 'audio',
      original: true,
      sourceUrl,
      audioUrl: sourceUrl,
      previewUrl: coverUrl,
      coverUrl,
      hasAudio: true
    }],
    source: 'clips-music'
  };
}

function bestAudioCover(data, fallback) {
  const meta = data?.metadata || {};
  const sound = meta.original_sound_info || {};
  const music = meta.music_info?.music_asset_info || meta.music_info || {};
  const artist = sound.ig_artist || music.ig_artist || {};
  const clipImages = [];
  for (const item of data?.items || []) {
    clipImages.push(...imageUrlsFromMedia(item?.media || item));
  }
  return firstImageUrl([
    sound.cover_artwork_uri,
    music.cover_artwork_uri,
    ...clipImages,
    sound.cover_artwork_thumbnail_uri,
    music.cover_artwork_thumbnail_uri,
    artist.profile_pic_url_hd,
    artist.profile_pic_url,
    fallback
  ]);
}

function imageUrlsFromMedia(node) {
  if (!node || typeof node !== 'object') return [];
  const candidates = [...(node.image_versions2?.candidates || [])]
    .filter((candidate) => candidate?.url)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))
    .map((candidate) => candidate.url);
  return [
    node.display_uri,
    node.display_url,
    node.thumbnail_src,
    node.thumbnail_url,
    ...candidates
  ];
}

function firstImageUrl(values) {
  const urls = uniqueUrls(values).filter((url) => isMediaUrl(url) && !isVideoFileUrl(url));
  return urls.find((url) => !isLowResImage(url)) || urls[0] || null;
}

function imagePreviewUrl(value) {
  if (!value || !isMediaUrl(value) || isVideoFileUrl(value)) return null;
  return value;
}

function proxiedInlineUrl(url, kind) {
  return `${API_ORIGIN}/api/download?ticket=${encodeTicket({
    iss: 'reelsdl.net',
    aud: 'get.reelsdl.net',
    url,
    kind,
    exp: Date.now() + 5 * 60 * 1000
  })}&inline=1`;
}

async function safeFetch(initialUrl, allowHost, { headers, maxRedirects }) {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (url.protocol !== 'https:' || !allowHost(url.hostname)) throw new Error('Unsafe redirect was blocked.');
    const response = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(15_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect had no destination.');
    url = new URL(location, url);
  }
  throw new Error('Too many redirects.');
}

function pageHeaders() {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.instagram.com/',
    origin: 'https://www.instagram.com'
  };
  const cookie = cookieHeader(igSession?.jar || configuredCookieJar());
  if (cookie) headers.cookie = cookie;
  return headers;
}

function htmlPageHeaders() {
  const headers = {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9'
  };
  const cookie = cookieHeader(igSession?.jar || configuredCookieJar());
  if (cookie) headers.cookie = cookie;
  return headers;
}

function mediaHeaders() {
  return {
    ...pageHeaders(),
    accept: 'audio/mpeg,audio/mp4,audio/*,image/avif,image/webp,image/apng,image/*,video/mp4,video/*,*/*;q=0.8'
  };
}



function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    join(ROOT, 'node_modules', 'ffmpeg-static', binary),
    join(process.cwd(), 'node_modules', 'ffmpeg-static', binary)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath;
  } catch {
    return undefined;
  }
  return undefined;
}

function cleanContentType(value) { return value?.split(';')[0].trim().toLowerCase(); }
function extensionFor(type, kind) {
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3';
  if (type === 'audio/mp4' || type === 'audio/aac' || type === 'audio/x-m4a') return 'm4a';
  if (type === 'video/mp4' && kind === 'audio') return 'mp4';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (kind === 'audio') return 'mp3';
  return kind === 'video' ? 'mp4' : 'jpg';
}
function decodeHtml(value) {
  return String(value).replace(/&amp;/gi, '&').replace(/&#x27;/gi, "'").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function publicFetchMessage(error) {
  if (/temporarily limiting requests|circuit/i.test(error.message)) {
    return 'Instagram is temporarily limiting requests. Try again in a few minutes.';
  }

  if (/No active stories|stories may have expired/i.test(error.message)) {
    return 'No active stories were found. The stories may have expired or the account may be private.';
  }
  if (/No media was found in this highlight/i.test(error.message)) {
    return 'No media was found in this highlight. It may have been removed or the account may be private.';
  }
  if (/cannot be found|No Media Match|could not find that post/i.test(error.message)) {
    return 'Instagram could not find that post. It may be private, deleted, or the copied link is incomplete.';
  }
  if (/No publicly|incomplete/i.test(error.message)) {
    return 'No downloadable public media was found. The content may be private, login-gated, or no longer available.';
  }
  if (/Instagram.*returned 4(01|03|04|29)/i.test(error.message)) {
    return 'Instagram could not make that content available. Check the link and try again.';
  }
  return 'Instagram did not return public media for this link. Try again shortly, or make sure the content is publicly accessible.';
}

function isHardInstagramBlock(error) {
  return /(?:^|[^0-9])429(?:[^0-9]|$)|Please wait a few minutes|temporarily limiting/i.test(error?.message || '');
}

function stopIfHardBlock(error, failures, label) {
  failures.push(`${label}: ${error.message}`);
  if (!isHardInstagramBlock(error)) return;
  noteInstagramFailure();
  throw error;
}

function isCircuitOpen() {
  return Date.now() < circuit.openUntil;
}

function noteInstagramFailure() {
  const now = Date.now();
  if (now - circuit.lastStrike > CIRCUIT_STRIKE_WINDOW_MS) circuit.strikes = 0;
  circuit.strikes += 1;
  circuit.lastStrike = now;
  if (circuit.strikes >= CIRCUIT_TRIPS) {
    circuit.openUntil = now + CIRCUIT_OPEN_MS;
    circuit.strikes = 0;
    console.warn(`Instagram resolver: circuit open for ${CIRCUIT_OPEN_MS / 1000}s`);
  }
}

function noteInstagramSuccess() {
  circuit.strikes = 0;
}

function resolveCacheKey(url) {
  const post = parsePostPath(url.pathname);
  if (post?.shortcode) return `post:${post.shortcode}`;
  const audio = parseAudioPath(url.pathname);
  if (audio) return `audio:${audio.audioId}`;
  const story = parseStoryPath(url.pathname);
  if (story?.highlightId) return `highlight:${story.highlightId}`;
  if (story?.storyId) return `story:${story.username}:${story.storyId}`;
  if (story?.username) return `stories:${story.username}`;
  const cleaned = new URL(url.toString());
  cleaned.search = '';
  cleaned.hash = '';
  return `url:${cleaned.pathname}`;
}

function readMemoryCache(key) {
  const cached = pageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    pageCache.delete(key);
    return null;
  }
  pageCache.delete(key);
  pageCache.set(key, cached);
  return cached.value;
}

function writeMemoryCache(key, value) {
  pageCache.delete(key);
  pageCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  while (pageCache.size > CACHE_MAX) {
    const oldest = pageCache.keys().next().value;
    if (oldest == null) break;
    pageCache.delete(oldest);
  }
}

let runtimeCachePromise = null;

function runtimeCache() {
  if (runtimeCachePromise) return runtimeCachePromise;
  runtimeCachePromise = import('@vercel/functions')
    .then((mod) => (typeof mod.getCache === 'function' ? mod.getCache({ namespace: 'ig-resolve' }) : null))
    .catch(() => null);
  return runtimeCachePromise;
}

async function readPageCache(key) {
  const local = readMemoryCache(key);
  if (local) return local;
  try {
    const cache = await runtimeCache();
    const remote = cache ? await cache.get(key) : null;
    if (remote?.media?.length) {
      writeMemoryCache(key, remote);
      return remote;
    }
  } catch (error) {
    console.warn('Instagram resolver: runtime cache read failed:', error.message);
  }
  return null;
}

async function writePageCache(key, value) {
  writeMemoryCache(key, value);
  try {
    const cache = await runtimeCache();
    if (!cache) return;
    await cache.set(key, value, {
      ttl: CACHE_TTL_SECONDS,
      tags: ['ig-resolve'],
      name: 'instagram-post'
    });
  } catch (error) {
    console.warn('Instagram resolver: runtime cache write failed:', error.message);
  }
}

function allowRequest(ip) {
  return hitRateLimit(rateLimits, ip, REQUEST_LIMIT);
}

function allowDownload(ip) {
  return hitRateLimit(downloadLimits, ip, DOWNLOAD_LIMIT);
}

function hitRateLimit(store, ip, limit) {
  const now = Date.now();
  const active = (store.get(ip) || []).filter((time) => now - time < REQUEST_WINDOW_MS);
  if (active.length >= limit) return false;
  active.push(now);
  store.set(ip, active);
  return true;
}

function allowGlobalFetch() {
  const now = Date.now();
  while (globalFetches.length && now - globalFetches[0] >= GLOBAL_FETCH_WINDOW_MS) globalFetches.shift();
  if (globalFetches.length >= GLOBAL_FETCH_LIMIT) return false;
  globalFetches.push(now);
  return true;
}

function getClientIp(request) {
  const raw = String(request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '').split(',')[0].trim();
  if (/^[\d.]+$/.test(raw) || /^[0-9a-f:]+$/i.test(raw)) return raw;
  return 'unknown';
}

function encodeTicket(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function decodeTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length > TICKET_MAX_CHARS) return null;
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature || ticket.split('.').length !== 2) return null;
  const expected = createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  const received = Buffer.from(signature);
  const actual = Buffer.from(expected);
  if (received.length !== actual.length || !timingSafeEqual(received, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (payload.iss !== 'reelsdl.net' || payload.aud !== 'get.reelsdl.net') return null;
    if (!['audio', 'video', 'photo'].includes(payload.kind)) return null;
    if (payload.url && !/^https:\/\//i.test(payload.url)) return null;
    if (payload.audioUrl && !/^https:\/\//i.test(payload.audioUrl)) return null;
    if (payload.pageUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(payload.pageUrl)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readJson(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('Request is too large.');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON request.');
    return parsed;
  } catch (error) {
    if (error.message === 'Invalid JSON request.') throw error;
    throw new Error('Invalid JSON request.');
  }
}

function corsPreflight(request) {
  if (!allowApiPreflight(request)) {
    return new Response(null, { status: 403, headers: API_SECURITY_HEADERS });
  }
  return new Response(null, { status: 204, headers: apiResponseHeaders(request) });
}

function jsonResponse(status, payload) {
  const request = apiRequest.getStore();
  const body = JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      ...apiResponseHeaders(request)
    }
  });
}
