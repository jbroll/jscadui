export const createBlobWorker = ({ source, createObjectURL, revokeObjectURL, WorkerClass }) => {
  const url = createObjectURL(new Blob([source], { type: 'application/javascript' }))
  const worker = new WorkerClass(url)
  const terminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    terminate()
    revokeObjectURL(url)
  }
  return worker
}
