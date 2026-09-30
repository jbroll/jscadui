import { discoverPatternFiles, matchesScopes } from '@jscadui/openscad/pattern-files'

/**
 * A test for paths under `examplesRoot`: true when an exclude.txt (non-model
 * files and directories, every pattern anchored) or a skip.txt (models that do
 * not render) at or above the path hides it. generate-all-files reads them the
 * same way, so the grids and the demo browser list the same models. A
 * directory's path ends in /.
 * @param {string} examplesRoot
 * @returns {(path: string) => boolean}
 */
export function exampleExclusions(examplesRoot) {
  const exclude = discoverPatternFiles(examplesRoot, 'exclude.txt')
  const skip = discoverPatternFiles(examplesRoot, 'skip.txt')
  return (path) => matchesScopes(path, exclude, { anchored: true }) || matchesScopes(path, skip)
}
