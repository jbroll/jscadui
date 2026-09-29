// Tracks whether the source the agent last evaluated matches what writeModel
// last saved, so eval/measure/check results can carry it as `saved`.
export const createSaveTracker = () => {
  let evaluated = null
  let saved = null
  return {
    recordEval: (source) => {
      evaluated = source
    },
    recordSave: (source) => {
      saved = source
      evaluated = source
    },
    isSaved: () => evaluated !== null && evaluated === saved,
  }
}
