// https://stackoverflow.com/questions/52086611/regex-for-matching-js-import-statements
const IMPORT_REG = /import(?:(?:(?:[ \n\t]+([^ *\n\t{},]+)[ \n\t]*(?:,|[ \n\t]+))?([ \n\t]*\{(?:[ \n\t]*[^ \n\t"'{}]+[ \n\t]*,?)+\})?[ \n\t]*)|[ \n\t]*\*[ \n\t]*as[ \n\t]+([^ \n\t{}]+)[ \n\t]+)from[ \n\t]*(?:['"])([^'"\n]+)(['"])/
const EXPORT_REG = /export.*from/

/**
 * Whether a script goes through the Babel transform before it loads: every
 * TypeScript file, and a script with an import line or an export-from line.
 * The frame worker and the chat's eval backend both load by this rule.
 * @param {string} url
 * @param {string} script
 */
export const shouldTransform = (url, script) =>
  url.endsWith('.ts') || (script.includes('import') && (IMPORT_REG.test(script) || EXPORT_REG.test(script)))
