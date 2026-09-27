// Run ids tag streaming runs end to end: the app sends one with each
// jscadScript or jscadMain, the worker echoes it on every streamed batch, and
// the frame and app drop batches whose id is not the current run's. Model
// code shares the worker and can post its own jscadCells or jscadClaim, and
// each accepted message restarts the frame's kill timer, so a guessable id
// lets a model keep its own run alive past the model budget. Random ids make
// spoofed batches miss every open run and drop without touching the timers.
export const newRunId = () => crypto.randomUUID()
