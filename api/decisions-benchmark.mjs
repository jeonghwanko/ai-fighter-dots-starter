import { Problem } from './http.mjs';
import { reviewEvidence } from './decisions-review.mjs';
import { benchmarkConfig } from './responses-benchmark.mjs';

/** A generation worker may submit only evidence enrolled for its host by an operator, once per case. */
export async function benchmarkReview({ db, reviewer, responsesReviewer, host, caseId, body }) {
  const effectiveHost = host ?? (await db.rpc('af_generation_official', {})).data;
  const { data: row, error } = await db.from('af_decision_benchmark_cases').select('id,host_id,intent,evidence,expires_at')
    .eq('id', caseId).eq('host_id', effectiveHost).maybeSingle();
  if (error) throw new Problem(503, 'review-store-unavailable');
  if (!row) throw new Problem(404, 'not-found');
  if (Date.parse(row.expires_at) <= Date.now()) throw new Problem(410, 'benchmark-expired');
  const evidence = await reviewEvidence(body);
  const config = row.intent.benchmarkReview;
  if (config !== undefined) { benchmarkConfig(config, evidence.stage); reviewer = responsesReviewer; }
  if (!reviewer?.enabled) return { mode: 'off', status: 'disabled', advisory: true, visualApproval: false };
  // SQL compares the complete binding again while holding the shared quota lock.
  const mapped = { rpc: (name, args) => name === 'af_decision_review_start'
    ? db.rpc('af_decision_benchmark_start', { p_case: caseId, p_host: host, p_fingerprint: args.p_fingerprint,
      p_stage: args.p_stage, p_scope: args.p_scope, p_binding: args.p_binding })
    : db.rpc(name, args) };
  const job = { id: caseId, description: row.intent.description, brief: row.intent.brief,
    appearance_note: row.intent.appearance_note, motion_note: row.intent.motion_note };
  return reviewer.review({ db: mapped, job, host, lease: null, evidence, config });
}
