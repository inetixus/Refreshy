'use strict';

const MISTRAL_API = 'https://api.mistral.ai/v1/chat/completions';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/scrape';
const DEFAULT_MODEL = 'mistral-medium-latest';
const INSTALLER_EXT = ['.exe', '.msi', '.msix', '.appx', '.msixbundle', '.zip'];

function resolvePrompt(app) {
  const publisher = app.publisher ? ` by ${app.publisher}` : '';
  return [
    `The Windows app "${app.name}"${publisher} (version ${app.version || 'unknown'})`,
    'is not available on winget. I need its official download page.',
    'Reply ONLY with JSON: {"urls": ["https://..."]}',
    'The URLs must be official vendor download pages (up to 3, best guess first),',
    'not download portals like download.com or softpedia.'
  ].join(' ');
}

async function proposeDownloadPages(apiKey, app, model) {
  const res = await fetchWithTimeout(MISTRAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a meticulous Windows software packager. Reply with JSON only.' },
        { role: 'user', content: resolvePrompt(app) }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300
    })
  }, 45000);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mistral API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  return parseJsonField(content);
}

function parseJsonField(content) {
  if (!content) return [];
  try {
    const v = JSON.parse(content);
    if (Array.isArray(v)) return v.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
    if (Array.isArray(v.urls)) return v.urls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  } catch {
    const m = content.match(/\{[^]*\}/);
    if (m) return parseJsonField(m[0]);
  }
  return [];
}

function filterInstallerLinks(base, links) {
  const out = [];
  const seen = new Set();
  for (const raw of links || []) {
    if (!raw) continue;
    let u;
    try { u = new URL(raw, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const p = u.pathname.toLowerCase();
    if (!INSTALLER_EXT.some((ext) => p.endsWith(ext))) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
  }
  return out;
}

function isProbablyDownloadPage(url, markdown) {
  const u = url.toLowerCase();
  const text = String(markdown || '').slice(0, 20000).toLowerCase();
  return /download/.test(u) || /download/.test(text) || /installer|setup|\.exe|\.msi/.test(text);
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function scrapePage(apiKey, url) {
  const res = await fetchWithTimeout(FIRECRAWL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ url, formats: ['links', 'markdown'] })
  }, 60000);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Firecrawl error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const page = data.data || {};
  return {
    markdown: page.markdown || '',
    links: (page.links || []).map((l) => (typeof l === 'string' ? l : (l && l.url) || null)).filter(Boolean),
    finalUrl: (page.metadata && (page.metadata.sourceURL || page.metadata.url)) || url
  };
}

function pickDirectLink(markdown, links, pageUrl) {
  const mdMatches = String(markdown || '').match(/https?:\/\/[^\s)"'<>]+/g) || [];
  const direct = filterInstallerLinks(pageUrl, [...mdMatches, ...(links || [])]);
  if (direct.length) return direct[0];
  const deep = filterInstallerLinks(pageUrl, (links || []).filter((l) => /download|release|install|setup|latest/i.test(l)));
  return deep[0] || null;
}

async function resolveInstallerForApp(options, app) {
  const { mistralKey, firecrawlKey, model } = options;
  const pages = await proposeDownloadPages(mistralKey, app, model);
  if (!pages.length) {
    throw new Error('no website candidates returned');
  }
  let lastErr = null;
  for (const page of pages.slice(0, 3)) {
    try {
      const scraped = await scrapePage(firecrawlKey, page);
      if (!isProbablyDownloadPage(scraped.finalUrl, scraped.markdown)) continue;
      const link = pickDirectLink(scraped.markdown, scraped.links, scraped.finalUrl);
      if (link) return { url: link, foundOn: scraped.finalUrl };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('no installer link found on the proposed pages');
}

module.exports = {
  MISTRAL_API,
  FIRECRAWL_API,
  DEFAULT_MODEL,
  INSTALLER_EXT,
  resolvePrompt,
  proposeDownloadPages,
  parseJsonField,
  filterInstallerLinks,
  isProbablyDownloadPage,
  scrapePage,
  pickDirectLink,
  resolveInstallerForApp,
  fetchWithTimeout
};
