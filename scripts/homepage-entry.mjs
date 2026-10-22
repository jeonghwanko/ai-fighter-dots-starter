// Keep legacy creator handoffs working while public homepage anchors stay at /.
const creatorRedirect = `const params = new URLSearchParams(location.search); params.delete("lang");
const publicAnchors = ["#main", "#fighters", "#match", "#join"];
if ([...params].length || (location.hash && !publicAnchors.includes(location.hash))) {
  location.replace("./creator.html" + location.search + location.hash);
}`;

export function homepageEntries(homepage) {
  if (!homepage.includes('<head>') || !homepage.includes('<main')) throw new Error('Expected the built homepage document');
  return {
    'index.html': homepage.replace('<head>', '<head>\n<meta name="referrer" content="no-referrer">\n<script>' + creatorRedirect + '</script>'),
    'league.html': `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>ODDBOUT</title>
<link rel="canonical" href="./">
<script>location.replace("./" + location.search + location.hash);</script></head>
<body><a href="./">ODDBOUT 홈으로 · Open ODDBOUT</a></body></html>
`,
  };
}
