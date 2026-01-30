/** @type {import('./worker.interface.d.js').WorkerRpc } */
const rpc  = {}

const _d = rpc.getData('1')

const _r1 = rpc.getRecord1('aa')

const _r2 = rpc.getRecord2({id:"a",name:'b'})
