// Profile text limits from the published contract. Local session records, the local and cloud MCP tool schemas
// and the package check read these, so a profile one of them accepts is never rejected by another.
import spec from './v1/spec.json' with { type: 'json' };
import schema from './v1/fighter.schema.json' with { type: 'json' };

const profile = schema.properties.profile.properties;
export const profileLimits = Object.freeze({
  name: profile.name.maxLength,
  description: profile.description.maxLength,
  concept: spec.profileExtras.conceptMaxLength,
  displayName: spec.profileExtras.nameMaxLength,
  languages: spec.profileExtras.languages,
  moves: spec.profileExtras.namedMoves,
  moveName: spec.profileExtras.moveNameMaxLength,
  moveDescription: spec.profileExtras.moveDescriptionMaxLength,
  lineKeys: spec.profileLines.keys,
  line: spec.profileLines.maxLength,
});
