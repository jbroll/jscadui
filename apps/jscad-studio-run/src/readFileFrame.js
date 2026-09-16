import { createReadFile } from './fileMap.js'

// Replaces packages/require/src/readFileWeb.js inside the worker bundle (see
// the read-file-shim plugin in build.js). The built-in readFileWeb resolves
// against self.location.origin, which is 'null' in a blob worker, so the
// worker's every read goes through the project file map instead.
export const readFileWeb = (path, options) => {
  const files = self.__PROJECT_FILES__ ?? {}
  return createReadFile(files)(path, options)
}