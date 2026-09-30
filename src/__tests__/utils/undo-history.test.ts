/// <reference types="jest" />

import {
  canRedo,
  canUndo,
  emptyHistory,
  MAX_UNDO_STEPS,
  recordBookPass,
  recordStep,
  redo,
  undo,
} from '../../utils/undo-history';

describe('undo history', () => {
  it('undoes a step back to the content before it', () => {
    const history = recordStep(emptyHistory<string>(), 'before');
    expect(undo(history, 'after')?.content).toBe('before');
  });

  it('redoes an undone step back to the content it undid', () => {
    const undone = undo(recordStep(emptyHistory<string>(), 'before'), 'after');
    expect(undone && redo(undone.history, undone.content)?.content).toBe('after');
  });

  it('undoes steps latest first', () => {
    const history = recordStep(recordStep(emptyHistory<string>(), 'first'), 'second');
    const once = undo(history, 'third');
    expect(once && undo(once.history, once.content)?.content).toBe('first');
  });

  it('has nothing to undo before any step', () => {
    const history = emptyHistory<string>();
    expect(canUndo(history)).toBe(false);
    expect(undo(history, 'present')).toBeUndefined();
  });

  it('can undo once a step is recorded', () => {
    expect(canUndo(recordStep(emptyHistory<string>(), 'before'))).toBe(true);
  });

  it('has nothing to redo until a step is undone', () => {
    const history = recordStep(emptyHistory<string>(), 'before');
    expect(canRedo(history)).toBe(false);
    expect(redo(history, 'after')).toBeUndefined();
  });

  it('can redo once a step is undone', () => {
    const undone = undo(recordStep(emptyHistory<string>(), 'before'), 'after');
    expect(undone && canRedo(undone.history)).toBe(true);
  });

  it('discards the undone steps when a new step is recorded', () => {
    const undone = undo(recordStep(emptyHistory<string>(), 'before'), 'after');
    expect(undone && canRedo(recordStep(undone.history, undone.content))).toBe(false);
  });

  it('forgets the oldest step beyond the cap', () => {
    let history = emptyHistory<number>();
    for (let before = 0; before <= MAX_UNDO_STEPS; before += 1)
      history = recordStep(history, before);

    const restored: number[] = [];
    let move = undo(history, MAX_UNDO_STEPS + 1);
    while (move) {
      restored.push(move.content);
      move = undo(move.history, move.content);
    }
    expect(restored).toHaveLength(MAX_UNDO_STEPS);
    expect(restored.at(-1)).toBe(1);
  });

  describe('re-anchor passes', () => {
    /** A pass that marks the content with a label, so a test can see which passes ran. */
    const tagWith = (bookCode: string) => (content: string) => `${content}|${bookCode}`;

    it('replays a pass that ran after the restored step', () => {
      const history = recordBookPass(
        recordStep(emptyHistory<string>(), 'before'),
        'GEN',
        tagWith('GEN'),
      );
      expect(undo(history, 'after|GEN')?.content).toBe('before|GEN');
    });

    it('does not replay a pass the restored content already had', () => {
      const history = recordStep(
        recordBookPass(emptyHistory<string>(), 'GEN', tagWith('GEN')),
        'before|GEN',
      );
      expect(undo(history, 'after|GEN')?.content).toBe('before|GEN');
    });

    it("replays only a book's latest pass", () => {
      let history = recordStep(emptyHistory<string>(), 'before');
      history = recordBookPass(history, 'GEN', tagWith('GEN-old'));
      history = recordBookPass(history, 'GEN', tagWith('GEN-new'));
      expect(undo(history, 'after|GEN-new')?.content).toBe('before|GEN-new');
    });

    it('replays the latest pass of every book', () => {
      let history = recordStep(emptyHistory<string>(), 'before');
      history = recordBookPass(history, 'GEN', tagWith('GEN'));
      history = recordBookPass(history, 'EXO', tagWith('EXO'));
      expect(undo(history, 'after|GEN|EXO')?.content).toBe('before|GEN|EXO');
    });

    it('replays on redo a pass that ran while the step was undone', () => {
      const undone = undo(recordStep(emptyHistory<string>(), 'before'), 'after');
      const history = undone && recordBookPass(undone.history, 'GEN', tagWith('GEN'));
      expect(history && redo(history, 'before|GEN')?.content).toBe('after|GEN');
    });
  });
});
