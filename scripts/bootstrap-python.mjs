// @ts-check
// The global Python that runs the stdlib-only release helpers (fetch-creator-kit.py, zip-plugin.py).
// macOS and Linux often ship only python3; AI_FIGHTER_BOOTSTRAP_PYTHON overrides both.
export const bootstrapPython = () => process.env.AI_FIGHTER_BOOTSTRAP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
