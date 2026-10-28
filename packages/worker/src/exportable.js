// Reference parts (purchased hardware) and previewOnly ghosts are drawn and
// checked, never exported.
export const exportableSolids = (solids) => solids.filter((solid) => !solid?.reference && !solid?.previewOnly)
