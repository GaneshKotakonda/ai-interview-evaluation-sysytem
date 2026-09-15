import { useEffect, useRef, useState } from 'react';
import { Camera, Lightbulb, Mic, RefreshCw, Wifi, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DeviceCheck from '../components/DeviceCheck';

export default function Readiness() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [networkReady, setNetworkReady] = useState(navigator.onLine);
  const [consent, setConsent] = useState(false);
  const [checking, setChecking] = useState(true);
  const [permissionError, setPermissionError] = useState('');

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const runDeviceCheck = async () => {
    stopStream();
    setChecking(true);
    setPermissionError('');
    setCameraReady(false);
    setMicrophoneReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError('Media devices are not supported in this browser.');
      setChecking(false);
      return;
    }

    const tracks = [];
    const errors = [];

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTracks = cameraStream.getVideoTracks();
      tracks.push(...videoTracks);
      setCameraReady(videoTracks.length > 0);
    } catch (error) {
      errors.push(`Camera: ${error?.message || 'permission required'}`);
    }

    try {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTracks = microphoneStream.getAudioTracks();
      tracks.push(...audioTracks);
      setMicrophoneReady(audioTracks.length > 0);
    } catch (error) {
      errors.push(`Microphone: ${error?.message || 'permission required'}`);
    }

    if (tracks.length > 0) {
      const combinedStream = new MediaStream(tracks);
      streamRef.current = combinedStream;
      if (videoRef.current) videoRef.current.srcObject = combinedStream;
    }

    if (errors.length > 0) setPermissionError(errors.join(' · '));
    setChecking(false);
  };

  useEffect(() => {
    runDeviceCheck();
    const updateNetwork = () => setNetworkReady(navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    return () => {
      stopStream();
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canContinue = cameraReady && microphoneReady && networkReady && consent;

  const handleContinue = () => {
    if (!canContinue) return;
    stopStream();
    navigate('/interview');
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">Device Readiness</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Before You Begin</h1>
        <p className="mt-2 text-slate-500">Let's make sure your setup is ready for the interview.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Camera Preview</h2>
                <p className="mt-1 text-sm text-slate-500">Your preview stays local to the browser.</p>
              </div>
              <button onClick={runDeviceCheck} disabled={checking} className="secondary-btn !px-3 !py-2">
                <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Recheck
              </button>
            </div>
          </div>
          <div className="bg-slate-950 p-3 sm:p-5">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-slate-300">
                  <div><Camera className="mx-auto h-8 w-8" /><p className="mt-3 text-sm">{checking ? 'Checking camera access...' : 'Camera preview unavailable'}</p></div>
                </div>
              )}
            </div>
          </div>
          {permissionError && <div className="border-t border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">{permissionError}</div>}
        </section>

        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="font-bold text-slate-900">Readiness Checks</h2>
            <p className="mt-1 text-sm text-slate-500">All required checks must pass before continuing.</p>
            <div className="mt-5 space-y-3">
              <DeviceCheck icon={Camera} label="Camera" status={cameraReady ? 'Ready' : 'Permission Required'} ready={cameraReady} helper="Video input for interview capture" />
              <DeviceCheck icon={Mic} label="Microphone" status={microphoneReady ? 'Ready' : 'Permission Required'} ready={microphoneReady} helper="Audio input for response recording" />
              <DeviceCheck icon={Wifi} label="Network" status={networkReady ? 'Connected' : 'Offline'} ready={networkReady} helper="Browser connectivity status" />
              <DeviceCheck icon={Lightbulb} label="Lighting" status={cameraReady ? 'Good' : 'Waiting'} ready={cameraReady} helper="Prototype status; real analysis can be added later" />
            </div>
          </div>

          <div className="card p-5">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-navy-800 focus:ring-navy-600" />
              <span className="text-sm leading-6 text-slate-700">I consent to audio and video capture for this mock interview.</span>
            </label>
            <button onClick={handleContinue} disabled={!canContinue} className="primary-btn mt-5 w-full">
              Continue to Interview <ArrowRight className="h-4 w-4" />
            </button>
            {!canContinue && <p className="mt-3 text-center text-xs text-slate-400">Camera, microphone, network, and consent are required.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
