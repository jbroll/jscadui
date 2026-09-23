// Project metadata (name, entry, conversation) travels as a dotfile beside the
// files: in a linked folder and an exported zip.
export const META_PATH = '.jscad-web.json'
// Written by jscad-studio; read but never written.
export const LEGACY_META_PATH = '.jscad-studio.json'

export const isMetaPath = (path) => path === META_PATH || path === LEGACY_META_PATH
