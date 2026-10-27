// A package's way in, shared by the creator's own routes (`handler.mjs`) and the hosted generation worker's (`generations.mjs`, 2026-10-27):
// the fighter.json checked the same way, its WebP assets stored the same way. No Node-only imports: Deno and Node.
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { Problem, readBody, sha256, unstorableTextPath } from './http.mjs';

export const BUCKET = 'ai-fighter-beta';
export const objectKey = (submission, asset) => `${submission.owner_id}/${submission.asset_source_submission ?? submission.id}/${asset.id}.webp`;

/** A request body as a fighter.json the contract accepts: its text, sha256 and asset bytes. Problem(422) names what fails. */
export async function checkedManifest(request) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, spec.limits.jsonBytes)); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-utf8'); }
  const parsed = parseFighterJson(text);
  if (!parsed.ok) throw new Problem(422, 'invalid-manifest', parsed.errors.slice(0, 20));
  const result = validateFighter(parsed.data);
  if (!result.ok) throw new Problem(422, 'invalid-manifest', result.errors.slice(0, 20));
  // Reject here with 422. Otherwise the jsonb cast in af_create_submission fails and the API returns 503.
  const unstorable = unstorableTextPath(parsed.data);
  if (unstorable !== null) throw new Problem(422, 'invalid-manifest', [{ code: 'UNSUPPORTED_TEXT', path: unstorable,
    expected: 'text without U+0000 or unpaired surrogates', actual: 'unsupported character' }]);
  return { text, sha: await sha256(new TextEncoder().encode(text)), bytes: result.assetBytes };
}

/** One asset of an uploading submission, its bytes checked against the manifest and stored once (a retry of the same bytes succeeds). */
export async function storeAsset(db, row, assetId, request) {
  if (row.status !== 'uploading' || new Date(row.expires_at).getTime() <= Date.now()) throw new Problem(409, 'upload-closed');
  const asset = row.manifest.assets.find(a => a.id === assetId);
  if (!asset) throw new Problem(404, 'asset-not-found');
  if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
  const bytes = await readBody(request, asset.bytes);
  if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP') throw new Problem(422, 'webp-required');
  const bucket = db.storage.from(BUCKET), path = objectKey(row, asset);
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) {
    // An existing immutable object is a successful retry only if its actual bytes still match.
    const { data, error: getError } = await bucket.download(path);
    if (getError || !data || data.size !== asset.bytes || await sha256(await data.arrayBuffer()) !== asset.sha256) throw new Problem(503, 'storage-unavailable');
  }
  return { ok: true, stage: 'uploaded', assetId: asset.id, bytes: bytes.length };
}
