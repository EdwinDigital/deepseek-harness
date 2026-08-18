import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-web-search-microsoft-webiq',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)