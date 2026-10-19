// Authoring limits live here; gait frame counts come from the existing game owner.
// build-contract.mjs emits the portable JSON files Dots and future services read.
const frameStandard = { roles: { fighter: { walk: 16, run: 12 } } }; // Published v1 snapshot.

const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const ref = name => ({ $ref: `#/definitions/${name}` });
const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const step = integer(0, 127);
const pair = { ...array(step, 2, 2) };
const borrowed = object({ clip: { enum: ['fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'] }, frame: integer(0, 63) });

export const motions = {
  idle: { kind: 'gait', frames: 1, loop: false, purpose: '정지 전신. 모든 동작과 같은 정체성.' },
  walk: { kind: 'gait', frames: frameStandard.roles.fighter.walk, loop: true, purpose: '걷기 한 주기. 양발 교대, 같은 접지 기준.' },
  run: { kind: 'gait', frames: frameStandard.roles.fighter.run, loop: true, purpose: '달리기 한 주기. 양발 교대.' },
  fightIdle: { kind: 'action', loop: true, minHits: 0, maxHits: 0, purpose: '전투 준비 자세 반복.' },
  combo: { kind: 'action', loop: false, minHits: 3, maxHits: 8, purpose: '3개 구간으로 나누어 재생할 연타. 접촉 시점 최소 3개.' },
  slam: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '강타의 준비·접촉·회수.' },
  dash: { kind: 'action', loop: false, minHits: 0, maxHits: 1, purpose: '돌진. 준비와 회수는 같은 선수의 명시한 프레임 사용.' },
  block: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '가드와 막기. 접촉 직전 단계가 유지 자세.' },
  hit: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '피격·뒤로 젖힘·비틀거림·복귀.' },
  groggy: { kind: 'action', loop: true, minHits: 0, maxHits: 0, purpose: '기절/흔들림 반복.' },
  fall: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '넘어짐·착지·누움. 일어서기 프레임도 명시.' },
};

export const limits = Object.freeze({ jsonBytes: 262144, assetBytes: 4000000, packageAssetBytes: 10000000,
  assetCount: 16, imageDimension: 4096, imagePixels: 16777216, packagePixels: 33554432, clipDurationMs: 10000 });

const landmarks = {
  combo: object({ spinStart: step }),
  hit: object({ recoil: step, stagger: pair, recover: pair }),
  dash: object({ windup: borrowed, recover: borrowed }),
  fall: object({ lieSequenceIndex: step, getUp: array(object({ ...borrowed.properties, durationMs: number(1, 2000) }), 2, 8) }),
};

function clipSchema(name, motion) {
  const fields = {
    assetId: id, frameWidth: integer(1, 1024), frameHeight: integer(1, 1024),
    columns: integer(1, 8), rows: integer(1, 8),
    frames: { ...array(integer(0, 63), motion.frames ?? 1, motion.frames ?? 64), uniqueItems: true },
    origins: array(ref('origin'), motion.frames ?? 1, motion.frames ?? 64), loop: { const: motion.loop },
  };
  if (motion.kind === 'gait') {
    fields.durationMs = number(1, 2000);
    if (name === 'walk') fields.stridePixels = number(1, 1600);
  } else {
    fields.sequence = array(object({ frame: integer(0, 63), durationMs: number(1, 2000) }), 1, 128);
    fields.hitSequenceIndices = { ...array(step, motion.minHits, motion.maxHits), uniqueItems: true };
    if (landmarks[name]) fields.landmarks = landmarks[name];
  }
  return { ...object(fields), description: motion.purpose };
}

export const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:ai-fighter:side:v1:fighter',
  title: 'AI Fighter side-view authoring package v1',
  description: '제작 입력 전용. 통과는 등록/승인이 아니다. 실제 파일 검사는 별도로 수행한다.',
  ...object({
    schemaVersion: { const: 1 }, specVersion: { const: 'ai-fighter-side-v1' }, localId: id,
    profile: object({ name: text(40), description: text(600), portrait: ref('imageView'), preview: ref('imageView') }),
    combat: object({ kitId: { const: 'standard-duel' } }),
    appearance: object({ projection: { const: 'orthographic' }, elevationDegrees: { const: 16 },
      sourceFacing: { const: 'right' }, leftFacing: { const: 'mirror' }, bodyHeight: { const: 400 }, bodyScale: { const: 1 } }),
    assets: array(ref('asset'), 1, limits.assetCount),
    clips: object(Object.fromEntries(Object.entries(motions).map(([name, motion]) => [name, clipSchema(name, motion)]))),
  }),
  definitions: {
    asset: object({ id, path: { type: 'string', maxLength: 100, pattern: '^assets/[a-z][a-z0-9-]{0,47}\\.webp$' },
      mediaType: { const: 'image/webp' }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      bytes: integer(1, limits.assetBytes), width: integer(1, limits.imageDimension), height: integer(1, limits.imageDimension) }),
    imageView: object({ assetId: id, crop: object({ x: integer(0, limits.imageDimension), y: integer(0, limits.imageDimension),
      width: integer(1, 1024), height: integer(1, 1024) }) }),
    origin: object({ originX: number(0, 1024), originY: number(0, 1024),
      groundContacts: array(object({ x: number(0, 1024), y: number(0, 1024), rx: number(0.1, 512), ry: number(0.1, 512) }), 0, 2) }),
  },
};

export const spec = {
  schemaVersion: 1, specVersion: 'ai-fighter-side-v1', status: 'authoring-contract',
  files: { guide: 'README.md', schema: 'fighter.schema.json', example: 'example.fighter.json' },
  input: { manifest: 'fighter.json', assetsDirectory: 'assets', animationMetadata: 'inline:clips',
    imageEncoding: 'static-webp-with-alpha', frameIndex: 'zero-based-row-major', originUnit: 'frame-local-pixels',
    durationUnit: 'milliseconds', frames: 'contiguous-zero-based', landmarks: 'sequence-step-indices-except-borrowed-frame',
    mirror: 'right-source-left-runtime-flip', bodyHeight: 400, cameraElevationDegrees: 16 },
  limits, motions,
  combatKits: [{ id: 'standard-duel', description: '서버가 관리하는 기본 대결 규칙. 제작자는 HP·피해·사거리·코드·AI 지시를 제출하지 않는다.',
    integration: 'pending-game-integration',
    currentConsumers: { player: 'FighterFightSkin / Lupin rules', opponent: 'NativeCityKumaArt / CityFighters rules' },
    warning: '현재 플레이어와 AI 상대 규칙은 다르다. 이 ID는 서버 연결 계약이며 통합 경쟁 규칙 구현을 뜻하지 않는다.' }],
  validationStages: ['schema', 'references-and-geometry', 'bytes-hashes-and-full-decode', 'runtime-preview', 'visual-review', 'server-registration'],
  notClientFields: ['ownerId', 'fighterId', 'approved', 'runtimeApproved', 'status', 'hp', 'damage', 'script'],
  registration: { available: false, reason: '오프라인 제작 계약. 연결된 서버의 /spec에서 베타 등록 가능 여부를 확인한다. 게임 동적 로딩은 별도다.' },
};
