import { useEffect, useRef, useState } from 'react';
import { Eye, ScanFace, Users, Activity } from 'lucide-react';
import { analyzeFaceResult, createVisionStats, getFaceLandmarker, metricsSnapshot } from '../services/visionAnalyzer';

const SAMPLE_INTERVAL_MS = 200;

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="rounded-lg bg-slate-50 p-2 text-slate-600"><Icon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export default function BehaviorMonitor({ videoRef, active, onMetricsChange }) {
  const [status, setStatus] = useState('Loading vision model…');
  const [metrics, setMetrics] = useState(null);
  const statsRef = useRef(createVisionStats());
  const previousTimeRef = useRef(null);
  const animationRef = useRef(null);
  const runningRef = useRef(false);
  const previousMultipleFaceRef = useRef(false);
  const onMetricsChangeRef = useRef(onMetricsChange);

  useEffect(() => {
    onMetricsChangeRef.current = onMetricsChange;
  }, [onMetricsChange]);

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
            const stats = statsRef.current;

            stats.observedMs += elapsed;
            stats.framesAnalyzed += 1;
            if (observation.facePresent) stats.facePresentMs += elapsed;
            if (observation.eyeContact) stats.eyeContactMs += elapsed;
            if (observation.headCentered) stats.headCenteredMs += elapsed;
            const multipleFacesNow = observation.faceCount > 1;
            if (multipleFacesNow && !previousMultipleFaceRef.current) stats.multipleFaceEvents += 1;
            previousMultipleFaceRef.current = multipleFacesNow;
            stats.expressionMs[observation.expression] = (stats.expressionMs[observation.expression] || 0) + elapsed;

            const snapshot = metricsSnapshot(stats);
            setMetrics({ ...snapshot, faceCount: observation.faceCount, expression: observation.expression });
            onMetricsChangeRef.current?.(snapshot);
          } catch (error) {
            setStatus(error?.message || 'Vision analysis error');
          }

          window.setTimeout(() => {
            animationRef.current = requestAnimationFrame(loop);
          }, SAMPLE_INTERVAL_MS);
        };

        animationRef.current = requestAnimationFrame(loop);
      } catch (error) {
        if (!cancelled) setStatus(`Vision unavailable: ${error?.message || 'model failed to load'}`);
      }
    };

    start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [active, videoRef]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-tealish-600" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Behaviour Analysis</p>
            <p className="text-xs text-slate-500">{status}</p>
          </div>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full ${status === 'Live analysis active' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
      </div>

      {metrics && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric icon={ScanFace} label="Face presence" value={`${metrics.facePresence}%`} />
          <Metric icon={Eye} label="Eye contact" value={`${metrics.eyeContact}%`} />
          <Metric icon={Activity} label="Camera facing" value={`${metrics.cameraFacing}%`} />
          <Metric icon={Users} label="Faces now" value={metrics.faceCount > 0 ? metrics.faceCount : 'None'} />
        </div>
      )}

      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        This module reports observable video signals such as face presence, gaze direction and head alignment. It does not infer personality, hiring suitability, or mental state.
      </p>
    </div>
  );
}
