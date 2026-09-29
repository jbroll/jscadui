// Agent export metadata: total the exported bytes for the model to see,
// but keep the bytes themselves out of the tool result.
export const createExport = (exportData) => async ({ format }) => {
  const { data = [] } = await exportData({ format })
  const chunks = (data instanceof Array ? data : [data]).filter((v) => v instanceof ArrayBuffer)
  const size = chunks.reduce((n, v) => n + v.byteLength, 0)
  return { ok: true, format, size }
}
