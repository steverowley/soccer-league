// ── pages/ManagerDetail.test.ts ─────────────────────────────────────────────
// The manager page shows the game model (entities.meta.game_model) in plain
// words. These tests pin the reading: engine enums become pundit words,
// shapes stay as shapes, metre and second targets never reach the page
// (hidden mechanics), and anything unknown is dropped rather than shown raw.

import { describe, expect, it } from 'vitest';
import { readGameModel } from './ManagerDetail';

const STORED = {
  tempo: 'patient', width: 'wide', onLoss: 'counterpress', onRegain: 'secure',
  restShape: '2+3', blockWidth: 38, blockHeight: 'high', blockLength: 32,
  restDefence: 5, buildUpShape: '2-3-5', fullBackRole: 'invert',
  pressTriggers: ['back_pass', 'bad_touch'], lineManagement: 'measured',
  counterpressSec: 5, settledLineHeight: 50, counterpressPlayers: 4,
};

describe('readGameModel', () => {
  it('turns the stored model into plain-word groups', () => {
    const view = readGameModel(STORED);
    expect(view?.inPossession).toEqual([
      ['Build-up shape', '2-3-5'],
      ['Full-backs', 'Tuck inside'],
      ['Tempo', 'Patient'],
      ['Width', 'Wide'],
    ]);
    expect(view?.transitions).toEqual([
      ['On losing the ball', 'Counter-press'],
      ['On winning it back', 'Keep the ball'],
    ]);
    expect(view?.outOfPossession).toEqual([
      ['Block', 'High block'],
      ['Defensive line', 'Measured'],
      ['Rest defence', '5 behind the ball (2+3)'],
    ]);
    expect(view?.pressTriggers).toEqual(['Back pass', 'Heavy touch']);
  });

  it('never shows the metre and second targets', () => {
    const text = JSON.stringify(readGameModel(STORED));
    for (const n of ['38', '32', '50']) expect(text).not.toContain(n);
  });

  it('drops unknown values and returns null when nothing is readable', () => {
    const view = readGameModel({ tempo: 'warp', buildUpShape: 'all-out', width: 'narrow' });
    expect(view?.inPossession).toEqual([['Width', 'Narrow']]);
    expect(readGameModel({ tempo: 'warp' })).toBeNull();
    expect(readGameModel(null)).toBeNull();
    expect(readGameModel(['wide'])).toBeNull();
  });
});
