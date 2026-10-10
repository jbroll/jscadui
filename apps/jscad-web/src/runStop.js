// The Stop button beside the progress bar: visible while the frame has jobs,
// calling jscadAbort once per run. Test seam: everything DOM lives here;
// main.js only constructs it and forwards jobs/cells.
export const bindStopButton = ({ button, workerApi, onError = console.error }) => {
  let cells = null
  // Tracked separately from `disabled`: a jobs update re-enables the button, so
  // only this flag keeps a double click from sending a second abort while the
  // first is still in flight.
  let aborting = false
  const paint = () => {
    button.textContent = cells === null ? 'Stop' : `Stop (${cells} cells)`
  }
  const setRunning = (running) => {
    button.style.display = running ? '' : 'none'
    if (running) {
      if (!aborting) button.disabled = false
    } else {
      aborting = false
      button.disabled = false
    }
  }
  const setCells = (count) => {
    cells = count
    paint()
  }
  button.style.display = 'none'
  button.addEventListener('click', () => {
    if (aborting) return
    aborting = true
    button.disabled = true
    workerApi.jscadAbort().catch(onError).finally(() => { aborting = false })
  })
  return { setRunning, setCells }
}
