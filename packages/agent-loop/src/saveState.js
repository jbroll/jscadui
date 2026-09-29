export const NOT_SAVED = 'this model is not saved; call writeModel to keep it'

// eval, measure and check results say so while the model they describe is not the one last written.
export const withSaveState = (result, unsaved) => (unsaved ? { ...result, notSaved: NOT_SAVED } : result)
