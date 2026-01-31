
async function handleFromEntry(entry)
{
  const handle = {
      name: entry.name,
      kind: entry.isFile      ? 'file' :
            entry.isDirectory ? 'directory' :
                                'unknown',
    }

  if (handle.kind === 'file') {
    handle.getFile = () => new Promise((resolve, reject) =>
      entry.file(resolve, reject))
  }
  else if (handle.kind === 'directory') {
    handle.values = async function* () {
        const reader = entry.createReader()
        while (true) {
          const entries = await new Promise((resolve, reject) =>
            reader.readEntries(resolve, reject))
          if (!entries.length) {
            break
          }
          for (const e of entries) {
            try {
              yield await handleFromEntry(e)
            }
            catch (err) {
              console.warn('Safari file handle error for entry:', e?.name, err)
              continue
            }
          }
        }
      }
  }
  else {
    throw new TypeError('Entry must be file or directory')
  }

  return handle
}


/**
 *
 * @param {DataTransferItem} dti
 * @returns {Promise<FileSystemHandle>}
 */
export async function safariGetAsHandle(dti)
{
  // L4 fix: Validate DataTransferItem before accessing webkitGetAsEntry
  if (!dti || typeof dti.webkitGetAsEntry !== 'function') {
    throw new TypeError('Invalid DataTransferItem: webkitGetAsEntry not available')
  }
  const entry = dti.webkitGetAsEntry()
  if (!entry) {
    throw new Error('Failed to get entry from DataTransferItem')
  }
  return handleFromEntry(entry)
}

