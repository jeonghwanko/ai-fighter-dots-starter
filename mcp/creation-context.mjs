import source from '../deploy/creation-context-source.json' with { type: 'json' };
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

const groups = ['appearance', 'locomotion', 'attacks', 'defense', 'final'];
export function validateCreationContext(data) {
  if (data?.contextVersion !== 1 || data.owner !== 'game' || data.specVersion !== spec.specVersion ||
      !/^[a-f0-9]{64}$/.test(data.revision ?? '')) throw new Error('creation-context-incompatible');
  if (data.workflow?.groups?.map(g => g.id).join(',') !== groups.join(',')) throw new Error('creation-context-groups');
  const motions = data.workflow.groups.flatMap(g => g.motions);
  const required = Object.keys(data.contract?.motions ?? {});
  if (new Set(motions).size !== motions.length || [...motions].sort().join(',') !== required.sort().join(',') ||
      required.sort().join(',') !== Object.keys(spec.motions).sort().join(',')) throw new Error('creation-context-motions');
  if (!data.controls?.actions || !data.timing?.clocks || !data.workflow.gates) throw new Error('creation-context-incomplete');
  return data;
}

export async function fetchCreationContext({ request = fetch, group } = {}) {
  const response = await request(source.url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('creation-context-unavailable');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 128 * 1024) { await reader.cancel(); throw new Error('creation-context-too-large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = validateCreationContext(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (!group) return data;
  const current = data.workflow.groups.find(item => item.id === group);
  if (!current) throw new Error('creation-context-group');
  return { ...data, contract: { ...data.contract,
    motions: Object.fromEntries(current.motions.map(id => [id, data.contract.motions[id]])) },
    workflow: { ...data.workflow, currentGroup: current } };
}

/** Pure boundary check. Feedback interpretation is the agent's job; this never invents user acceptance. */
export function reviewCreationProgress(context, state) {
  validateCreationContext(context);
  const blockers = [], sequence = context.workflow.groups;
  if (!['creation', 'dialogue-only'].includes(state.mode)) blockers.push('invalid-mode');
  if (state.contextRevision !== context.revision) blockers.push('context-changed');
  const index = sequence.findIndex(group => group.id === state.groupId);
  if (index < 0) return { canAdvance: false, blockers: [...blockers, 'unknown-group'], nextGroup: null };
  const allowed = new Set(sequence.flatMap(g => [...g.motions, ...(g.auxiliaries ?? [])]));
  for (const id of Object.keys(state.items ?? {})) if (!allowed.has(id)) blockers.push(`unknown-item:${id}`);
  for (const id of state.delegatedGroups ?? []) if (!sequence.some(g => g.id === id)) blockers.push(`unknown-delegation:${id}`);
  for (const group of sequence.slice(0, index + 1)) {
    for (const id of [...group.motions, ...(group.auxiliaries ?? [])]) {
      const item = state.items?.[id];
      if (!item || typeof item.version !== 'string' || !item.version) { blockers.push(`missing:${id}`); continue; }
      if (item.selectedVersion !== item.version && !(state.delegatedGroups ?? []).includes(group.id)) blockers.push(`unselected:${id}`);
      const acceptedReview = state.mode === 'dialogue-only' ? ['hypothetical'] : ['passed'];
      if (!acceptedReview.includes(item.review)) blockers.push(`unchecked:${id}`);
      if ((state.pendingEdits ?? []).includes(id)) blockers.push(`pending-edit:${id}`);
    }
  }
  for (const id of state.pendingEdits ?? []) if (!allowed.has(id)) blockers.push(`unknown-edit:${id}`);
  if (state.groupId === 'final') {
    if (!state.profile?.selected) blockers.push('profile-unselected');
    if (state.mode === 'creation' && state.packageReview !== 'passed') blockers.push('package-unchecked');
  }
  return { canAdvance: blockers.length === 0, blockers, nextGroup: blockers.length ? null : sequence[index + 1]?.id ?? null,
    registrationAuthorized: false, mode: state.mode, contextRevision: context.revision };
}
