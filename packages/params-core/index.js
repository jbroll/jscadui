export {
  // Core proxy
  createParamsProxy,
  createProxyState,

  // Type inference
  inferType,
  isDefinition,
  extractDefinition,

  // Tree building
  buildParamTree,
  toParamDefinitions,
  extractDefaults,

  // Tree navigation
  getBreadcrumbs,
  getNodeByPath,
  getParamsAtPath,
  getChildParts,

  // Class linking
  getClassesForType,
  getTypesFromClasses,
  groupByClass,
  getLinkedParts,
  getLinkedParamPaths,

  // Legacy support
  convertLegacyDefs,
  extractLegacyDefaults,
  wrapLegacyModule,

  // Utilities
  toMap,
} from './src/createParamsProxy.js'
