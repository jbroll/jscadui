// measure and check sizes are model units, which exports and slicers read as millimetres.
export const withUnits = (result) => (result?.ok === false ? result : { units: 'mm', ...result })
