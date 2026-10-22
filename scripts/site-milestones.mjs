// Only the ODDBOUT build consumes these hooks; the shared game's simulation stays unchanged.
export const milestoneVirtualId = 'virtual:oddbout-milestones';
function bridge() {
  const bouts = new WeakMap();
  function milestone(name, bout, parameters = {}) {
    if (!bout) return;
    let seen = bouts.get(bout);
    if (!seen) { seen = new Set(); bouts.set(bout, seen); }
    if (seen.has(name) || name === 'match_complete' && !seen.has('game_start')) return;
    seen.add(name);
    window.dispatchEvent(new CustomEvent('oddbout:milestone', { detail: { name, parameters } }));
  }
  function creationStart() {
    window.dispatchEvent(new CustomEvent('oddbout:milestone', { detail: { name: 'creation_start', parameters: { method: 'request_copy' } } }));
  }
  function bindIdentity(api, token, key) {
    const bind = () => window.oddboutBindAnalytics?.(api, token, key);
    bind(); window.addEventListener('oddbout:analytics-ready', bind, { once: true });
  }
  return { milestone, creationStart, bindIdentity };
}
export const milestoneModule = `const {milestone, creationStart, bindIdentity} = (${bridge.toString()})(); export {milestone, creationStart, bindIdentity};`;
const targets = {
  '/src/render/scenes/ArenaDuelScene.ts': [
    ['if (decided) duel.session.settle(); else duel.session.step(control ? [control.command(this.playerSide()), null] : undefined);', 'if (!decided) milestone("game_start", duel.session, { mode: this.dataIn.tournament ? "tournament" : this.dataIn.player ? "play" : "watch" });\n        if (decided) duel.session.settle(); else duel.session.step(control ? [control.command(this.playerSide()), null] : undefined);'],
    ['private finish(result: CityFightBoutResult): void {', 'private finish(result: CityFightBoutResult): void {\n    milestone("match_complete", this.duel?.session, { result: result.how });'],
    ['if (this.live()) { this.recorded = true;', 'if (this.live()) { milestone("match_complete", this.duel?.session, { result: "forfeit" }); this.recorded = true;'],
  ],
  '/src/render/scenes/ArenaScene.ts': [
    ['this.started = true;\n    this.combat.challenge();', 'this.started = true;\n    milestone("game_start", this.bout, { mode: this.entryData.mode });\n    this.combat.challenge();'],
    ['private finish(result: ArenaBoutResult): void {', 'private finish(result: ArenaBoutResult): void {\n    milestone("match_complete", this.bout, { result: result.how });'],
  ],
  '/src/creator/main.ts': [
    ['await navigator.clipboard.writeText(request.value);', 'await navigator.clipboard.writeText(request.value);\n        creationStart();'],
  ],
  '/src/platform/fighterCreator.ts': [
    ['this.user = data.user; this.access = { token, expiresAt: claims.exp };', 'this.user = data.user; this.access = { token, expiresAt: claims.exp };\n    bindIdentity(this.config.api, token, this.config.key);'],
  ],
};
export function transformMilestones(code, id) {
  const match = Object.entries(targets).find(([suffix]) => id.replaceAll('\\', '/').endsWith(suffix));
  if (!match) return null;
  let result = code.replaceAll('\r\n', '\n');
  for (const [before, after] of match[1]) {
    if (result.split(before).length !== 2) throw new Error('Review ODDBOUT milestone hook: ' + match[0]);
    result = result.replace(before, after);
  }
  return `import { milestone, creationStart, bindIdentity } from '${milestoneVirtualId}';\n` + result;
}
export function milestonePlugin() {
  return { name: 'oddbout-milestones',
    resolveId(id) { if (id === milestoneVirtualId) return '\0oddbout-milestones'; },
    load(id) { if (id === '\0oddbout-milestones') return milestoneModule; },
    transform: transformMilestones };
}
