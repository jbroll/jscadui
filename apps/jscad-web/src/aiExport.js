import { exportConfig, exportedSize } from '@jscadui/agent-loop'

// Agent export metadata: total the exported bytes for the model to see,
// but keep the bytes themselves out of the tool result.
export const createExport = (exportData) => async ({ format }) => {
  const { id } = exportConfig(format)
  const { data = [] } = await exportData({ format: id })
  return { ok: true, format, size: exportedSize(data) }
}
