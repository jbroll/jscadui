/** @type {import('./worker.interface.d.js').WorkerRpc } */
const rpc  = {}

const d = rpc.getData('1')

const r1 = rpc.getRecord1('aa')

const r2 = rpc.getRecord2({id:"a",name:'b'})
