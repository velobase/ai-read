import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { createSpeechDiagnostics, type SpeechMetrics } from '../adapters/diagnostics';
import {
  speechChunks,
  type SpeechChunk,
  type SpeechPlan,
  type SpeechSegment,
} from '../adapters/speech-plan';

export type ReaderSpeechStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'complete' | 'error';
export type ReaderSpeechCurrent = Pick<
  SpeechSegment,
  | 'paragraphId'
  | 'chapterIndex'
  | 'chapterTitle'
  | 'text'
  | 'source'
  | 'language'
  | 'translationKey'
  | 'startOffset'
  | 'endOffset'
> & { textOffset: number };
export type ReaderSpeechState = {
  status: ReaderSpeechStatus;
  current: ReaderSpeechCurrent | null;
  ordinal: number;
  total: number;
  canNext: boolean;
  canPrevious: boolean;
  reason?: 'missing-translation' | 'speech-error';
};

const idleState: ReaderSpeechState = {
  status: 'idle',
  current: null,
  ordinal: 0,
  total: 0,
  canNext: false,
  canPrevious: false,
};
// Expo owns one synthesizer. Serialize across Reader mounts too: a late cleanup
// must never stop a new Reader's utterance after that Reader has started it.
let speechCommands = Promise.resolve();
let speechOwner: symbol | null = null;
const command = (operation: () => Promise<void> | void): Promise<void> => {
  const next = speechCommands.then(operation);
  speechCommands = next.catch(() => undefined);
  return next;
};
type Flight = { token: number; chunk: SpeechChunk; started: boolean };
type Run = {
  generation: number;
  plan: SpeechPlan;
  index: number;
  chunks: SpeechChunk[];
  chunkIndex: number;
  offset: number;
  rangeStart: number;
  rate: number;
  desired: 'speaking' | 'paused';
  flight: Flight | null;
  terminal: boolean;
  startedAt: number;
};

class SpeechController {
  private readonly owner = Symbol('reader-speech');
  private readonly diagnostics = createSpeechDiagnostics();
  private generation = 0;
  private nextFlight = 0;
  private run: Run | null = null;
  private alive = true;
  private visible = true;
  private state = idleState;
  private lastPublished = 0;
  private boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  private startTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly update: (state: ReaderSpeechState) => void) {}

  activate() {
    this.alive = true;
    this.diagnostics.record('mount');
  }
  dispose() {
    this.alive = false;
    void this.stop();
    this.diagnostics.dispose();
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = undefined;
    } else if (this.run) this.publish(this.run, this.state.status, this.state.reason);
  }
  private current(run: Run) {
    return (
      this.alive &&
      this.run === run &&
      run.generation === this.generation &&
      speechOwner === this.owner
    );
  }
  private currentFlight(run: Run, flight: Flight) {
    return this.current(run) && run.flight === flight && !run.terminal;
  }
  private metrics(run: Run): SpeechMetrics {
    return {
      session: run.generation,
      paragraphIndex: run.index,
      paragraphCount: run.plan.totalParagraphs,
      chunkIndex: run.chunkIndex,
      chunkLength: run.flight?.chunk.text.length || run.chunks[run.chunkIndex]?.text.length || 0,
      offset: run.offset,
      charLength: 0,
      rate: run.rate,
      elapsedMs: Date.now() - run.startedAt,
    };
  }
  private clearTimers() {
    clearTimeout(this.boundaryTimer);
    clearTimeout(this.startTimer);
    this.boundaryTimer = undefined;
    this.startTimer = undefined;
  }
  private publish(run: Run, status: ReaderSpeechStatus, reason?: ReaderSpeechState['reason']) {
    if (!this.current(run)) return;
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = undefined;
    const segment = run.plan.segments[run.index];
    const missing = !segment ? run.plan.firstMissing : null;
    const current: ReaderSpeechCurrent | null = segment
      ? {
          paragraphId: segment.paragraphId,
          chapterIndex: segment.chapterIndex,
          chapterTitle: segment.chapterTitle,
          text: segment.text,
          source: segment.source,
          language: segment.language,
          translationKey: segment.translationKey,
          startOffset: run.rangeStart,
          endOffset: segment.endOffset,
          textOffset: run.offset,
        }
      : missing
        ? {
            ...missing,
            text: '',
            source: 'translation',
            startOffset: 0,
            endOffset: 0,
            textOffset: 0,
          }
        : null;
    this.state = {
      status,
      current,
      ordinal: current ? run.index + 1 : 0,
      total: run.plan.totalParagraphs,
      canPrevious: run.index > 0,
      canNext: run.index + 1 < run.plan.segments.length || (!!segment && !!run.plan.firstMissing),
      ...(reason ? { reason } : {}),
    };
    this.lastPublished = Date.now();
    this.update(this.state);
  }
  private publishBoundary(run: Run) {
    if (!this.visible || this.boundaryTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - this.lastPublished));
    const publish = () => {
      this.boundaryTimer = undefined;
      if (this.visible && this.current(run) && !run.terminal)
        this.publish(run, run.desired === 'paused' ? 'paused' : 'speaking');
    };
    if (wait) this.boundaryTimer = setTimeout(publish, wait);
    else publish();
  }
  private fail(run: Run) {
    if (!this.current(run) || run.terminal) return;
    this.diagnostics.record('error', this.metrics(run));
    this.clearTimers();
    run.flight = null;
    run.terminal = true;
    this.publish(run, 'error', 'speech-error');
    void command(async () => {
      if (this.current(run)) {
        try {
          await Speech.stop();
        } catch {
          /* Error is already visible; an explicit restart may retry. */
        }
      }
    });
  }
  private watchStart(run: Run, flight: Flight) {
    clearTimeout(this.startTimer);
    // This SDK's iOS module never sends onError, and speak() discards its native
    // promise. Bound loading when native speech never delivers a start/boundary.
    this.startTimer = setTimeout(() => {
      void command(async () => {
        if (!this.currentFlight(run, flight) || run.desired !== 'speaking' || flight.started)
          return;
        this.diagnostics.record('startTimeout', this.metrics(run));
        try {
          const speaking = await Speech.isSpeakingAsync();
          if (!this.currentFlight(run, flight) || run.desired !== 'speaking' || flight.started)
            return;
          // isSpeaking also includes paused utterances; only consult it while
          // this session still explicitly wants speech, never to infer pause.
          if (!speaking) this.fail(run);
          else {
            flight.started = true;
            this.publish(run, 'speaking');
          }
        } catch {
          if (this.currentFlight(run, flight) && run.desired === 'speaking' && !flight.started)
            this.fail(run);
        }
      });
    }, 15000);
  }
  private advance(run: Run) {
    if (!this.current(run) || run.terminal || run.flight) return;
    if (AppState.currentState !== 'active') run.desired = 'paused';
    const previousIndex = run.index;
    while (run.index < run.plan.segments.length && run.chunkIndex >= run.chunks.length) {
      run.index++;
      run.chunks = run.plan.segments[run.index]?.chunks || [];
      run.chunkIndex = 0;
      run.offset = run.plan.segments[run.index]?.startOffset || 0;
      if (run.plan.segments[run.index]) run.rangeStart = run.offset;
    }
    if (run.index !== previousIndex) this.diagnostics.record('paragraph', this.metrics(run));
    if (run.index >= run.plan.segments.length) {
      run.terminal = true;
      if (run.plan.firstMissing) this.publish(run, 'error', 'missing-translation');
      else {
        run.index = Math.max(0, run.plan.segments.length - 1);
        run.offset = run.plan.segments[run.index]?.endOffset || 0;
        this.publish(run, 'complete');
      }
      return;
    }
    if (run.desired === 'paused') {
      this.publish(run, 'paused');
      return;
    }
    const segment = run.plan.segments[run.index];
    const flight = { token: ++this.nextFlight, chunk: run.chunks[run.chunkIndex], started: false };
    run.flight = flight;
    run.offset = flight.chunk.start;
    this.publish(run, 'loading');
    this.watchStart(run, flight);
    try {
      Speech.speak(flight.chunk.text, {
        language: segment.language,
        rate: run.rate,
        useApplicationAudioSession: false,
        onStart: () => {
          if (!this.currentFlight(run, flight)) return;
          flight.started = true;
          clearTimeout(this.startTimer);
          this.diagnostics.record('nativeStart', this.metrics(run));
          this.publish(run, run.desired === 'paused' ? 'paused' : 'speaking');
        },
        onBoundary: ({ charIndex, charLength }: { charIndex: number; charLength: number }) => {
          if (!this.currentFlight(run, flight) || !Number.isFinite(charIndex)) return;
          flight.started = true;
          clearTimeout(this.startTimer);
          let offset =
            flight.chunk.start +
            Math.max(0, Math.min(flight.chunk.text.length, Math.floor(charIndex)));
          const code = segment.text.charCodeAt(offset),
            previous = segment.text.charCodeAt(offset - 1);
          if (code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff)
            offset--;
          run.offset = Math.max(run.offset, offset);
          this.diagnostics.boundary({ ...this.metrics(run), charLength });
          this.publishBoundary(run);
        },
        onDone: () => {
          if (!this.currentFlight(run, flight)) return;
          this.clearTimers();
          run.offset = flight.chunk.end;
          this.diagnostics.record('done', this.metrics(run));
          run.flight = null;
          run.chunkIndex++;
          void command(() => this.advance(run));
        },
        onStopped: () => {
          if (this.currentFlight(run, flight)) {
            this.diagnostics.record('stopped', this.metrics(run));
            this.fail(run);
          }
        },
        onError: () => {
          if (this.currentFlight(run, flight)) this.fail(run);
        },
      });
    } catch {
      this.fail(run);
    }
  }
  private replace(
    plan: SpeechPlan,
    rate: number,
    index: number,
    paused: boolean,
    replay: boolean | number = false,
    event: 'startCommand' | 'paragraph' | 'background' | 'pause' = 'startCommand',
  ) {
    if (!this.alive) return Promise.resolve();
    this.clearTimers();
    const segment = plan.segments[index];
    const startOffset =
      typeof replay === 'number'
        ? Math.max(0, Math.min(segment?.endOffset || 0, replay))
        : replay
          ? 0
          : segment?.startOffset || 0;
    const run: Run = {
      generation: ++this.generation,
      plan,
      index,
      chunks: segment
        ? replay !== false
          ? speechChunks(segment.text, startOffset, segment.endOffset)
          : segment.chunks
        : [],
      chunkIndex: 0,
      offset: startOffset,
      // Resuming keeps the original progress range; explicitly revisiting a
      // paragraph still restarts it at zero, as before precise selections.
      rangeStart:
        typeof replay === 'number' && this.run?.plan === plan && this.run.index === index
          ? this.run.rangeStart
          : startOffset,
      rate: Number.isFinite(rate) ? Math.min(2, Math.max(0.1, rate)) : 1,
      desired: paused ? 'paused' : 'speaking',
      flight: null,
      terminal: false,
      startedAt: Date.now(),
    };
    this.run = run;
    speechOwner = this.owner;
    this.diagnostics.record(event, this.metrics(run));
    this.publish(run, 'loading');
    return command(async () => {
      if (!this.current(run)) return;
      try {
        await Speech.stop();
      } catch {
        this.fail(run);
        return;
      }
      if (this.current(run)) this.advance(run);
    });
  }
  start = (plan: SpeechPlan, rate: number): Promise<void> => {
    // Own the snapshot; later translations/preferences cannot extend a running scope.
    const frozen: SpeechPlan = {
      ...plan,
      firstMissing: plan.firstMissing ? { ...plan.firstMissing } : null,
      segments: plan.segments.map((segment) => ({
        ...segment,
        chunks: segment.chunks.map((chunk) => ({ ...chunk })),
      })),
    };
    return this.replace(frozen, rate, 0, AppState.currentState !== 'active');
  };
  background = (): Promise<void> => {
    const run = this.run;
    if (!run || !this.current(run) || run.terminal) return Promise.resolve();
    // Release the native utterance instead of retaining background audio. Resume
    // is explicit and starts at the last UTF-16 word boundary (possibly repeats it).
    return this.replace(run.plan, run.rate, run.index, true, run.offset, 'background');
  };
  pause = (): Promise<void> => {
    const run = this.run;
    if (!run || !this.current(run) || run.terminal) return Promise.resolve();
    // AVSpeech's pause can return false before an utterance actually starts,
    // but Expo discards that boolean. Cancel pending startup instead of claiming
    // a successful pause while a late native start could keep speaking.
    if (run.flight && !run.flight.started)
      return this.replace(run.plan, run.rate, run.index, true, run.offset, 'pause');
    run.desired = 'paused';
    this.diagnostics.record('pause', this.metrics(run));
    clearTimeout(this.startTimer);
    return command(async () => {
      if (!this.current(run) || run.desired !== 'paused' || run.terminal) return;
      try {
        if (run.flight) await Speech.pause();
      } catch {
        this.fail(run);
        return;
      }
      if (this.current(run) && run.desired === 'paused' && !run.terminal)
        this.publish(run, 'paused');
    });
  };
  resume = (): Promise<void> => {
    const run = this.run;
    if (!run || !this.current(run) || run.terminal || AppState.currentState !== 'active')
      return Promise.resolve();
    run.desired = 'speaking';
    this.diagnostics.record('resume', this.metrics(run));
    return command(async () => {
      if (
        !this.current(run) ||
        run.desired !== 'speaking' ||
        run.terminal ||
        AppState.currentState !== 'active'
      )
        return;
      if (!run.flight) {
        this.advance(run);
        return;
      }
      try {
        await Speech.resume();
      } catch {
        this.fail(run);
        return;
      }
      if (!this.current(run) || run.desired !== 'speaking' || run.terminal) return;
      if (run.flight && !run.flight.started) this.watchStart(run, run.flight);
      this.publish(run, run.flight?.started ? 'speaking' : 'loading');
    });
  };
  stop = (): Promise<void> => {
    this.diagnostics.record('stopCommand', this.run ? this.metrics(this.run) : {});
    const generation = ++this.generation;
    this.clearTimers();
    this.run = null;
    this.state = idleState;
    if (this.alive) this.update(idleState);
    return command(async () => {
      if (speechOwner !== this.owner || generation !== this.generation) return;
      try {
        await Speech.stop();
      } catch {
        if (this.alive && generation === this.generation) {
          this.state = { ...idleState, status: 'error', reason: 'speech-error' };
          this.update(this.state);
        }
      }
      if (speechOwner === this.owner && generation === this.generation) speechOwner = null;
    });
  };
  private move(direction: -1 | 1): Promise<void> {
    const run = this.run;
    if (!run || !this.current(run)) return Promise.resolve();
    const index = run.index + direction;
    if (index < 0 || index >= run.plan.segments.length + (run.plan.firstMissing ? 1 : 0))
      return Promise.resolve();
    return this.replace(
      run.plan,
      run.rate,
      index,
      run.desired === 'paused' && !run.terminal,
      true,
      'paragraph',
    );
  }
  next = () => this.move(1);
  previous = () => this.move(-1);
}

/** Foreground-only speech; navigation/progress remain explicitly controlled by the Reader. */
export function useReaderSpeech({ visible = true }: { visible?: boolean } = {}) {
  const [state, setState] = useState<ReaderSpeechState>(idleState);
  const controller = useRef<SpeechController | null>(null);
  if (!controller.current) controller.current = new SpeechController(setState);
  const speech = controller.current;
  useEffect(() => {
    speech.setVisible(visible);
  }, [speech, visible]);
  useEffect(() => {
    speech.activate();
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active') void speech.background();
    });
    return () => {
      subscription.remove();
      speech.dispose();
    };
  }, [speech]);
  return {
    state,
    start: speech.start,
    pause: speech.pause,
    resume: speech.resume,
    stop: speech.stop,
    next: speech.next,
    previous: speech.previous,
  };
}
