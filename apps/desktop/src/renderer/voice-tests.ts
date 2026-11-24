// Uyandırma alıştırması ve yankı sınaması: kurulum sihirbazı ile Ayarlar › Ses aynı iki sınamayı aynı kanallardan
// (`setup.calibrateWake`, `setup.echoTest`) koşar. Burada yalnız durum vardır; görünüm çağıranındır.
//
// İkisi de yalnız `start()` çağrılınca başlar: yankı sınaması hoparlörden ses çalar, kendiliğinden başlamamalıdır.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BargeTestResult, EchoTestResult, WakeCalibrationResult } from '@fuber/shared';

export type WakeSample = 'waiting' | 'listening' | 'heard' | 'retry';

export type TestPhase = 'idle' | 'running' | 'done' | 'failed';

interface TestRun<T> {
  phase: TestPhase;
  result: T | null;
  /** Kanal hata verdiyse (sınama hiç koşamadı) nedeni. */
  error: string | null;
  start(): void;
}

function useTest<T>(run: () => Promise<T>, onStart?: () => void): TestRun<T> {
  const [state, setState] = useState<Omit<TestRun<T>, 'start'>>({ phase: 'idle', result: null, error: null });
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;
    onStart?.();
    setState({ phase: 'running', result: null, error: null });
    run().then(
      (result) => {
        running.current = false;
        if (alive.current) setState({ phase: 'done', result, error: null });
      },
      (reason: unknown) => {
        running.current = false;
        if (alive.current) setState({ phase: 'failed', result: null, error: (reason as Error)?.message ?? String(reason) });
      },
    );
  }, [run, onStart]);

  return { ...state, start };
}

const fresh = (total: number): WakeSample[] => Array.from({ length: total }, () => 'waiting' as const);

/** "Üç kez Hey Jarvis deyin": her örneğin durumu `setup.calibrationProgress` olayından izlenir. */
export function useWakeCalibration(total = 3): TestRun<WakeCalibrationResult> & { samples: WakeSample[] } {
  const [samples, setSamples] = useState<WakeSample[]>(() => fresh(total));
  const run = useCallback(() => window.fuber.invoke('setup.calibrateWake', { samples: total }), [total]);
  const reset = useCallback(() => setSamples(fresh(total)), [total]);
  const test = useTest(run, reset);

  useEffect(
    () =>
      window.fuber.on('setup.calibrationProgress', (progress) => {
        const phase = progress.phase;
        if (phase === 'done') return;
        setSamples((list) => {
          const next = Array.from({ length: progress.total }, (_, index) => list[index] ?? ('waiting' as const));
          next[progress.index - 1] = phase;
          return next;
        });
      }),
    [],
  );

  // Sınama bittiğinde duyulmayan örnek "dinliyor" görünümünde kalmasın.
  const shown = test.phase === 'running' ? samples : samples.map((sample) => (sample === 'heard' ? sample : ('waiting' as const)));
  return { ...test, samples: shown };
}

/** Hoparlör yankısı sınaması. SES ÇALAR: yalnız kullanıcının düğmesinden `start()` ile başlatılır. */
export function useEchoTest(): TestRun<EchoTestResult> {
  const run = useCallback(() => window.fuber.invoke('setup.echoTest'), []);
  return useTest(run);
}

/** Söz kesme sınaması (Ayarlar › Ses). SES ÇALAR: yalnız kullanıcının düğmesinden `start()` ile başlatılır. */
export function useBargeTest(): TestRun<BargeTestResult> {
  const run = useCallback(() => window.fuber.invoke('voice.bargeTest'), []);
  return useTest(run);
}
