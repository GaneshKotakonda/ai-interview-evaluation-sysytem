import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Lightbulb,
  Mic,
  RefreshCw,
  Wifi,
  ArrowRight,
  Briefcase,
  FileText,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DeviceCheck from '../components/DeviceCheck';

// -------------------------------------------------------------
// BLOCK 1: Preset Job Descriptions for Quick Selection
// -------------------------------------------------------------
// Offers instant templates so candidates can test role-specific
// interviews without needing to paste external text manually.
const JOB_PRESETS = [
  {
    label: 'Full Stack Engineer',
    role: 'Full Stack Engineer',
    jd: 'Looking for a Full Stack Engineer proficient in React, Node.js/Python, and PostgreSQL. Responsibilities include building scalable APIs, optimizing database queries, implementing responsive component architectures, and maintaining end-to-end testing with CI/CD.',
  },
  {
    label: 'Frontend Developer',
    role: 'Frontend Developer (React)',
    jd: 'Seeking a Frontend Specialist with deep expertise in React, TypeScript, Tailwind CSS, and state management (Redux/Zustand). Must have experience with web performance optimization, WebRTC/WebSocket integrations, and cross-browser accessibility.',
  },
  {
    label: 'Backend Engineer',
    role: 'Backend Engineer (Python/FastAPI)',
    jd: 'Hiring a Backend Engineer experienced in Python, FastAPI, PostgreSQL, Redis caching, and Docker. Candidates should understand database indexing, RESTful microservices, asynchronous task queues, and secure authentication workflows.',
  },
  {
    label: 'DevOps / Cloud',
    role: 'DevOps & Cloud Engineer',
    jd: 'Targeting a Cloud Engineer proficient in Docker, Kubernetes, AWS/GCP infrastructure, Terraform, and automated CI/CD pipelines. Must be skilled in monitoring (Prometheus/Grafana), network security, and infrastructure reliability.',
  },
];

export default function Readiness() {
  const navigate = useNavigate();

  // -------------------------------------------------------------
  // BLOCK 2: Hardware & Media Stream References
  // -------------------------------------------------------------
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Device status states
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [networkReady, setNetworkReady] = useState(navigator.onLine);
  const [consent, setConsent] = useState(false);
  const [checking, setChecking] = useState(true);
  const [permissionError, setPermissionError] = useState('');

  // -------------------------------------------------------------
  // BLOCK 3: Target Role & Job Description Configuration State
  // -------------------------------------------------------------
  // Reads any previously selected role/JD from local storage, defaulting to Software Engineer.
  const [roleTitle, setRoleTitle] = useState(
    () => localStorage.getItem('target-role-title') || 'Software Engineer'
  );
  const [jobDescription, setJobDescription] = useState(
    () => localStorage.getItem('target-job-description') || ''
  );

  // -------------------------------------------------------------
  // BLOCK 4: Hardware Permission & Device Check Handlers
  // -------------------------------------------------------------
  // Stops any running camera tracks cleanly.
  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  // Tests user camera and microphone via WebRTC getUserMedia.
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

  // -------------------------------------------------------------
  // BLOCK 5: Navigation & Target Specification Persistence
  // -------------------------------------------------------------
  // Validates device checks and stores customized Role & JD to localStorage.
  const canContinue = cameraReady && microphoneReady && networkReady && consent;

  const handleContinue = () => {
    if (!canContinue) return;
    stopStream();

    // Persist target role and custom job description for Interview.jsx
    localStorage.setItem('target-role-title', roleTitle.trim() || 'Software Engineer');
    localStorage.setItem('target-job-description', jobDescription.trim());

    // Reset previous interview progress so fresh questions generate
    localStorage.removeItem('ai-interview-progress');
    localStorage.removeItem('ai-interview-duration');
    localStorage.removeItem('current-interview-id');

    navigate('/interview');
  };

  // Helper to quickly apply a preset job description
  const applyPreset = (preset) => {
    setRoleTitle(preset.role);
    setJobDescription(preset.jd);
  };

  // -------------------------------------------------------------
  // BLOCK 6: Render Component UI
  // -------------------------------------------------------------
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {/* Header Banner */}
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">
          Interview Preparation
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          Customize Your Interview & Check Readiness
        </h1>
        <p className="mt-2 text-slate-500">
          Configure the target job role, paste job description requirements, and verify your camera and mic setup.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          {/* Target Role & Job Description Configuration Card */}
          <section className="card p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-tealish-50 p-2.5 text-tealish-600">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">Target Role & Job Description</h2>
                  <p className="text-xs text-slate-500">
                    Gemini will generate 5 targeted questions directly assessing this role and requirements.
                  </p>
                </div>
              </div>
              {jobDescription.trim() && (
                <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:inline-flex">
                  <Sparkles className="h-3.5 w-3.5" /> JD Tailored
                </span>
              )}
            </div>

            <div className="mt-6 space-y-5">
              {/* Role Title Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Target Job Title
                </label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Full Stack Developer, Data Scientist, DevOps Specialist"
                  className="input-field mt-2"
                />
              </div>

              {/* Quick Template Presets */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Quick Role Templates:
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {JOB_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        roleTitle === preset.role
                          ? 'border-navy-800 bg-navy-900 text-white shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Job Description Textarea */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    <FileText className="h-4 w-4 text-slate-400" />
                    Job Description & Responsibilities (Optional)
                  </label>
                  <span className="text-xs text-slate-400">{jobDescription.length} characters</span>
                </div>
                <textarea
                  rows="4"
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description, required technologies, framework stack, or key qualifications here... AI will formulate interview questions tailored to these exact requirements."
                  className="input-field mt-2 resize-y leading-6"
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Leave blank to use the standard industry rubric for the selected job title.
                </p>
              </div>
            </div>
          </section>

          {/* Camera Video Preview Card */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Camera Preview</h2>
                  <p className="mt-1 text-sm text-slate-500">Your video remains private and local to your browser.</p>
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
                    <div>
                      <Camera className="mx-auto h-8 w-8" />
                      <p className="mt-3 text-sm">
                        {checking ? 'Verifying camera access...' : 'Camera preview unavailable'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {permissionError && (
              <div className="border-t border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
                {permissionError}
              </div>
            )}
          </section>
        </div>

        {/* Right Aside: Readiness Verification & Start Button */}
        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="font-bold text-slate-900">Readiness Checks</h2>
            <p className="mt-1 text-sm text-slate-500">All required inputs must be verified before continuing.</p>
            <div className="mt-5 space-y-3">
              <DeviceCheck
                icon={Camera}
                label="Camera"
                status={cameraReady ? 'Ready' : 'Permission Required'}
                ready={cameraReady}
                helper="Video input for interview tracking"
              />
              <DeviceCheck
                icon={Mic}
                label="Microphone"
                status={microphoneReady ? 'Ready' : 'Permission Required'}
                ready={microphoneReady}
                helper="Audio input for spoken answers"
              />
              <DeviceCheck
                icon={Wifi}
                label="Network"
                status={networkReady ? 'Connected' : 'Offline'}
                ready={networkReady}
                helper="Browser network connection"
              />
              <DeviceCheck
                icon={Lightbulb}
                label="Environment"
                status={cameraReady ? 'Good' : 'Waiting'}
                ready={cameraReady}
                helper="Adequate face lighting"
              />
            </div>
          </div>

          {/* Consent & Begin Button */}
          <div className="card p-5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-navy-800 focus:ring-navy-600"
              />
              <span className="text-sm leading-6 text-slate-700">
                I consent to audio, video, and behavior monitoring for this mock interview.
              </span>
            </label>
            <button
              onClick={handleContinue}
              disabled={!canContinue}
              className="primary-btn mt-5 w-full justify-center"
            >
              Continue to Interview <ArrowRight className="h-4 w-4" />
            </button>
            {!canContinue && (
              <p className="mt-3 text-center text-xs text-slate-400">
                Camera, microphone, network, and consent checkbox are required to start.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
