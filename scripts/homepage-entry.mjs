// Retain legacy creator handoffs and normalize old homepage URLs without a reload.
const homepageRoute = `if (/\\/(?:index|league)\\.html$/.test(location.pathname)) {
  history.replaceState(null, "", "./" + location.search + location.hash);
}
const params = new URLSearchParams(location.search); params.delete("lang");
const publicAnchors = ["#main", "#fighters", "#match", "#join"];
if ([...params].length || (location.hash && !publicAnchors.includes(location.hash))) {
  location.replace("./creator.html" + location.search + location.hash);
}`;

export function homepageEntries(homepage) {
  if (!homepage.includes('<head>') || !homepage.includes('<main')) throw new Error('Expected the built homepage document');
  const html = homepage.replace('<head>', '<head>\n<meta name="referrer" content="no-referrer">\n<script>' + homepageRoute + '</script>');
  // A full legacy document also works when a browser has cached the former root redirect.
  return { 'index.html': html, 'league.html': html };
}
