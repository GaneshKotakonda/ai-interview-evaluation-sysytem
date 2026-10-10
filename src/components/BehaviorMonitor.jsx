import { useEffect, useRef, useState } from 'react';
import { analyzeFaceResult, createVisionStats, getFaceLandmarker, metricsSnapshot } from '../services/visionAnalyzer';

// -------------------------------------------------------------
// Camera engagement monitor (MediaPipe Face Landmarker, in the browser)
// -------------------------------------------------------------
// Samples the live <video> about 5 times a second, accumulates how long a
// face was present / looking at the screen / facing the camera, and reports
// a snapshot to the parent through onMetricsChange. No video leaves the
// browser from this component; only the aggregated percentages are used.
//
// Two tallies are kept: one for the whole session and one for the current
// question (`segmentKey`), which resets whenever the question changes, so
// each submitted answer carries its own camera metrics.
//
// `onFrame(observation, time)` receives every analysed frame (face count,
// gaze, lip gap) for the interview's integrity checks; `sampleIntervalMs`
// is lowered there so eye movements while reading can be followed.
const SAMPLE_INTERVAL_MS = 200;

// Add one observation of `elapsed` milliseconds to a tally.
function record(stats, observation, elapsed, newMultipleFaceEvent) {
  stats.observedMs += elapsed;
  stats.framesAnalyzed += 1;
  if (observation.facePresent) stats.facePresentMs += elapsed;
  if (observation.eyeContact) stats.eyeContactMs += elapsed;
  if (observation.headCentered) stats.headCenteredMs += elapsed;
  if (newMultipleFaceEvent) stats.multipleFaceEvents += 1;
  stats.expressionMs[observation.expression] = (stats.expressionMs[observation.expression] || 0) + elapsed;
}

// One live reading: label, value and (for percentages) a thin bar.
function Metric({ label, value, percent }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="num font-mono text-ink">{value}</span>
      </div>
      {percent !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

export default function BehaviorMonitor({
  videoRef, active, onMetricsChange, segmentKey, onFrame, sampleIntervalMs = SAMPLE_INTERVAL_MS,
}) {
  const [status, setStatus] = useState('Loading vision model…');
  const [metrics, setMetrics] = useState(null);
  const statsRef = useRef(createVisionStats());
  const segmentStatsRef = useRef(createVisionStats());
  const previousTimeRef = useRef(null);
  const animationRef = useRef(null);
  const timeoutRef = useRef(null);
  const runningRef = useRef(false);
  const previousMultipleFaceRef = useRef(false);
  const onMetricsChangeRef = useRef(onMetricsChange);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onMetricsChangeRef.current = onMetricsChange;
    onFrameRef.current = onFrame;
  }, [onMetricsChange, onFrame]);

  // A new question starts a fresh per-answer tally.
  useEffect(() => {
    segmentStatsRef.current = createVisionStats();
    setMetrics(null);
  }, [segmentKey]);

  useEffect(() => {
    let cancelled = false;
    let landmarker;

    const start = async () => {
      if (!active || !videoRef?.current) return;

      try {
        setStatus('Loading vision model…');
        landmarker = await getFaceLandmarker();
        if (cancelled) return;

        setStatus('Live analysis active');
        runningRef.current = true;
        previousMultipleFaceRef.current = false;
        previousTimeRef.current = performance.now();

        const loop = () => {
          if (cancelled || !runningRef.current) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth === 0) {
            animationRef.current = requestAnimationFrame(loop);
            return;
          }

          const now = performance.now();
          const elapsed = Math.min(now - previousTimeRef.current, 1000);
          previousTimeRef.current = now;

          try {
            const result = landmarker.detectForVideo(video, Math.round(now));
            const observation = analyzeFaceResult(result);
            const multipleFacesNow = observation.faceCount > 1;
            const newMultipleFaceEvent = multipleFacesNow && !previousMultipleFaceRef.current;
            previousMultipleFaceRef.current = multipleFacesNow;
            record(statsRef.current, observation, elapsed, newMultipleFaceEvent);
            record(segmentStatsRef.current, observation, elapsed, newMultipleFaceEvent);

            const answerSnapshot = metricsSnapshot(segmentStatsRef.current);
            const sessionSnapshot = metricsSnapshot(statsRef.current);
            setMetrics({ ...answerSnapshot, faceCount: observation.faceCount, expression: observation.expression });
            onMetricsChangeRef.current?.(sessionSnapshot, answerSnapshot);
            onFrameRef.current?.(observation, now);
          } catch (error) {
            // Technical detail goes to the console, not to the candidate.
            console.warn('Camera analysis error', error);
            setStatus('Camera analysis paused; the interview continues normally.');
          }

          // Throttle: wait sampleIntervalMs, then sync with the next frame.
          timeoutRef.current = window.setTimeout(() => {
            animationRef.current = requestAnimationFrame(loop);
          }, sampleIntervalMs);
        };

        animationRef.current = requestAnimationFrame(loop);
      } catch (error) {
        if (!cancelled) {
          console.warn('Camera analysis unavailable', error);
          setStatus('Camera analysis unavailable in this browser; your interview is not affected.');
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [active, videoRef, sampleIntervalMs]);

  return (
    <section className="card reveal p-5" style={{ '--i': 4 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Camera Engagement</h2>
          <p className="mt-0.5 text-xs text-ink-3">This answer · {status}</p>
        </div>
        <span className={`mt-1.5 h-2 w-2 rounded-full ${status === 'Live analysis active' ? 'bg-ok' : 'bg-warn'}`} />
      </div>

      {metrics && (
        <div className="fade-in mt-2 divide-y divide-line">
          <Metric label="Face presence" value={`${metrics.facePresence}%`} percent={metrics.facePresence} />
          <Metric label="Approximate screen gaze" value={`${metrics.eyeContact}%`} percent={metrics.eyeContact} />
          <Metric label="Head alignment" value={`${metrics.cameraFacing}%`} percent={metrics.cameraFacing} />
          <Metric label="Faces now" value={metrics.faceCount > 0 ? metrics.faceCount : 'None'} />
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
        Observable video signals only: face presence, gaze direction and head alignment. It does not infer personality, hiring suitability or mental state.
      </p>
    </section>
  );
}
