let turnCounter = 0;

export function getTurnCounter(): number {
  return turnCounter;
}

export function incrementTurnCounter(): number {
  turnCounter += 1;
  return turnCounter;
}
