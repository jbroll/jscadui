// The Stop button beside the progress bar: visible while the frame has jobs,
// calling jscadAbort once per run. Test seam: everything DOM lives here;
// main.js only constructs it and forwards jobs/cells.
export const bindStopButton = ({ button, workerApi, onError = console.error }) => {
  let cells = null
  const paint = () => {
    button.textContent = cells === null ? 'Stop' : `Stop (${cells} cells)`
  }
  const setRunning = (running) => {
    button.style.display = running ? '' : 'none'
    if (running) button.disabled = false
  }
  const setCells = (count) => {
    cells = count
    paint()
  }
  button.style.display = 'none'
  button.addEventListener('click', () => {
    button.disabled = true
    workerApi.jscadAbort().catch(onError)
  })
  return { setRunning, setCells }
}
