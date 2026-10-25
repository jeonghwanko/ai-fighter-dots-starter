// Public channel identity is configured once in deploy/creator-site.json.
export function youtubeChannelPlugin(channelUrl) {
  if (!channelUrl) return null;
  const url = new URL(channelUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || !/^\/@[A-Za-z0-9_.-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('Expected the official public YouTube handle URL');
  }
  const href = url.href;
  return { name: 'oddbout-youtube-channel', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/creator/siteChrome.ts')) return null;
      // Newer sources draw their own brand icons from oddbout-community.json (YouTube among them): leave their footer alone.
      if (code.includes('club-social')) return null;
      const anchor = 'element.append(logo, tagline, nav);';
      if (code.split(anchor).length !== 2) throw new Error('Review the ODDBOUT social footer hook');
      return code.replace(anchor, anchor + '\n  const youtube = document.createElement("a"); youtube.href = ' + JSON.stringify(href) +
        '; youtube.textContent = "YouTube"; youtube.target = "_blank"; youtube.rel = "noopener noreferrer"; nav.append(youtube);');
    },
    transformIndexHtml: { order: 'pre', handler(html) {
      // Keep a usable public link in the homepage before its interactive footer mounts.
      return html.replace(/(<footer\b[^>]*>[\s\S]*?)(<\/nav>\s*<\/footer>)/,
        (_, content, end) => content + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">YouTube</a>' + end);
    } },
  };
}
