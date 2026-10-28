import { withTransferable } from '@jscadui/postmessage'
import { exportableSolids } from '@jscadui/worker/src/exportable.js'

export const serializeSolids = (serializer, options, solids) => {
  const data = serializer.serialize(options, exportableSolids(solids))
  return withTransferable({ data }, data.filter((v) => typeof v !== 'string'))
}
