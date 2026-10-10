import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  Camera,
  FileText,
  Keyboard,
  Mic,
  RefreshCw,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DeviceCheck from '../components/DeviceCheck';
import { Badge, FlowSteps, Notice, PageHeader, Panel, SectionTitle } from '../components/ui';
import { STORAGE_KEYS, clearInterviewProgress, readAnswerMode } from '../utils/interviewJourney';
import { api } from '../services/api';
import { speak } from '../services/speech';
import { NOISY_FLOOR, createVoiceMonitor } from '../services/voiceActivity';

// The backend stores role titles in a VARCHAR(100) column.
const ROLE_TITLE_MAX = 100;

// Same idea as the server's coding.suggests_coding: roles that write code.
const CODING_WORDS = ['software', 'developer', 'engineer', 'programm', 'coding', 'algorithm', 'data structure', 'dsa',
  'python', 'java', 'javascript', 'typescript', 'c++', 'backend', 'back-end', 'full stack', 'fullstack', 'frontend',
  'front-end', 'react', 'node', 'leetcode'];
export const suggestsCoding = (text) => CODING_WORDS.some((word) => (text || '').toLowerCase().includes(word));
const JOB_DESCRIPTION_MAX = 4000; // the backend uses at most 4000 characters

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
  // Spoken (default) or typed answers; the room/speaker checks below.
  const [answerMode, setAnswerMode] = useState(() => readAnswerMode());
  // Coding round (VPL): suggested from the role until the candidate decides.
  const [codingChoice, setCodingChoice] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [roomNoise, setRoomNoise] = useState('measuring'); // measuring | quiet | noisy
  const [speakerState, setSpeakerState] = useState('idle'); // idle | playing | done
  const monitorRef = useRef(null);

  // -------------------------------------------------------------
  // BLOCK 3: Target Role & Job Description Configuration State
  // -------------------------------------------------------------
  // Reads any previously selected role/JD from local storage, defaulting to Software Engineer.
  const [roleTitle, setRoleTitle] = useState(
    () => localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer'
  );
  const [jobDescription, setJobDescription] = useState(
    () => localStorage.getItem(STORAGE_KEYS.jobDescription) || ''
  );
  // Resume: parsed by the server; its text is kept here and sent when the interview starts.
  const [resume, setResume] = useState(() => {
    const text = localStorage.getItem(STORAGE_KEYS.resumeText) || '';
    return text ? { name: localStorage.getItem(STORAGE_KEYS.resumeName) || 'Saved resume', text } : null;
  });
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState('');

  const handleResumeFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setResumeBusy(true);
    setResumeError('');
    try {
      const parsed = await api.parseResume(file);
      setResume({ name: parsed.filename || file.name, text: parsed.resume_text });
    } catch (err) {
      setResumeError(err.detail || 'The resume could not be read. Upload a text-based PDF, DOCX or TXT file under 2 MB.');
    } finally {
      setResumeBusy(false);
    }
  };

  // -------------------------------------------------------------
  // BLOCK 4: Hardware Permission & Device Check Handlers
  // -------------------------------------------------------------
  // Stops any running camera tracks cleanly.
  const stopStream = () => {
    monitorRef.current?.stop();
    monitorRef.current = null;
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
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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

    // Live microphone meter and a 3-second background-noise check.
    setRoomNoise('measuring');
    if (streamRef.current?.getAudioTracks().length) {
      monitorRef.current = createVoiceMonitor(streamRef.current);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const snapshot = monitorRef.current?.snapshot();
      if (!snapshot) return;
      setMicLevel(snapshot.level);
      if (snapshot.elapsedMs > 3000) {
        setRoomNoise((current) => (current === 'measuring'
          ? (snapshot.noiseFloor > NOISY_FLOOR ? 'noisy' : 'quiet') : current));
      }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  const testSpeakers = async () => {
    setSpeakerState('playing');
    await speak({ phrase: 'speaker_test' },
      'This is a speaker test. If you can hear this clearly, your audio is ready for the interview.');
    setSpeakerState('done');
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
  const voiceMode = answerMode === 'voice';
  const codingRound = codingChoice ?? suggestsCoding(`${roleTitle} ${jobDescription}`);
  const canContinue = cameraReady && (microphoneReady || !voiceMode) && networkReady && consent;

  const handleContinue = () => {
    if (!canContinue) return;
    stopStream();

    // Persist target role and custom job description for Interview.jsx
    localStorage.setItem(STORAGE_KEYS.roleTitle, roleTitle.trim() || 'Software Engineer');
    localStorage.setItem(STORAGE_KEYS.jobDescription, jobDescription.trim());
    if (resume) {
      localStorage.setItem(STORAGE_KEYS.resumeText, resume.text);
      localStorage.setItem(STORAGE_KEYS.resumeName, resume.name);
    } else {
      localStorage.removeItem(STORAGE_KEYS.resumeText);
      localStorage.removeItem(STORAGE_KEYS.resumeName);
    }
    localStorage.setItem(STORAGE_KEYS.answerMode, answerMode);
    localStorage.setItem(STORAGE_KEYS.codingRound, codingRound ? 'on' : 'off');

    // Reset previous interview progress so fresh questions generate
    clearInterviewProgress();
    localStorage.removeItem(STORAGE_KEYS.interviewId);

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
  const checks = [
    { icon: Camera, label: 'Camera', status: cameraReady ? 'Ready' : 'Permission Required', ready: cameraReady, helper: 'Video input for engagement tracking' },
    { icon: Mic, label: 'Microphone', status: microphoneReady ? 'Ready' : 'Permission Required', ready: microphoneReady, helper: 'Speak to see the level move' },
    { icon: AudioLines, label: 'Room noise', status: { measuring: 'Measuring…', quiet: 'Quiet', noisy: 'Noisy' }[roomNoise], ready: roomNoise === 'quiet', helper: roomNoise === 'noisy' ? 'Background speech may be transcribed' : 'Background sound level' },
    { icon: Wifi, label: 'Network', status: networkReady ? 'Connected' : 'Offline', ready: networkReady, helper: 'Browser network connection' },
  ];
  const readyCount = checks.filter((check) => check.ready).length;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <FlowSteps current={0} />
      <PageHeader
        title="Set up your interview"
        description="Tell us the role you are preparing for, then check your camera and microphone. Questions adapt to this role as you answer."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Target role and job description */}
        <Panel i={1} className="p-6 sm:p-7">
          <SectionTitle
            title="Target role"
            description="Gemini writes each question for this role and the requirements you paste."
            action={(jobDescription.trim() || resume) && <Badge tone="ink">{resume ? 'Tailored to resume' : 'Tailored to JD'}</Badge>}
          />

          <div className="mt-7 space-y-7">
            <div>
              <label htmlFor="role-title" className="field-label">Job title</label>
              <input
                id="role-title"
                type="text"
                maxLength={ROLE_TITLE_MAX}
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="e.g. Full Stack Developer, Data Scientist"
                className="input-field !py-3 !text-base"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-ink-3">Templates</span>
                {JOB_PRESETS.map((preset) => {
                  const active = roleTitle === preset.role;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      aria-pressed={active}
                      className={`rounded-full border px-3 py-1 text-[13px] transition duration-200 ${
                        active
                          ? 'border-ink bg-ink text-paper'
                          : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="job-description" className="field-label">
                  Job description <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <span className="num font-mono text-xs text-ink-4">{jobDescription.length} / {JOB_DESCRIPTION_MAX}</span>
              </div>
              <textarea
                id="job-description"
                rows="9"
                maxLength={JOB_DESCRIPTION_MAX}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the responsibilities, required stack or key qualifications. Questions will target these requirements."
                className="input-field resize-y leading-relaxed"
              />
              <p className="mt-2 text-xs text-ink-3">Leave blank to use a standard rubric for the job title.</p>
            </div>

            <div>
              <label htmlFor="resume-file" className="field-label">
                Resume <span className="font-normal text-ink-3">(optional)</span>
              </label>
              {resume ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <FileText className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{resume.name}</span>
                  </span>
                  <button type="button" onClick={() => setResume(null)} className="secondary-btn !px-3 !py-1.5 text-xs" aria-label="Remove resume">
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <input
                  id="resume-file"
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={handleResumeFile}
                  disabled={resumeBusy}
                  className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm"
                />
              )}
              {resumeBusy && <p className="mt-2 text-xs text-ink-3">Reading your resume…</p>}
              {resumeError && <Notice tone="warn" role="alert" className="mt-2">{resumeError}</Notice>}
              <p className="mt-2 text-xs text-ink-3">
                PDF, DOCX or TXT, up to 2 MB. Some questions will be based on your projects and skills. The text is saved with this interview only.
              </p>
            </div>
          </div>
        </Panel>

        {/* Pre-flight: preview, checks, consent */}
        <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Panel i={2} className="overflow-hidden">
            <div className="relative aspect-video bg-ink">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-paper/60">
                  <div>
                    <Camera className="mx-auto h-6 w-6" strokeWidth={1.5} />
                    <p className="mt-2 text-[13px]">{checking ? 'Checking camera access…' : 'Camera preview unavailable'}</p>
                  </div>
                </div>
              )}
              <button
                onClick={runDeviceCheck}
                disabled={checking}
                className="btn absolute right-3 top-3 bg-ink/60 !px-3 !py-1.5 text-xs text-paper backdrop-blur hover:bg-ink/80"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} /> Recheck
              </button>
            </div>
            <div className="px-5 pb-2 pt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-ink">Readiness checks</h2>
                <span className="num font-mono text-xs text-ink-3">{readyCount}/{checks.length}</span>
              </div>
              <div className="mt-1 divide-y divide-line">
                {checks.map((check) => <DeviceCheck key={check.label} {...check} />)}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken" aria-label="Microphone level">
                <div className="h-full rounded-full bg-ink transition-[width] duration-150" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
              <button type="button" onClick={testSpeakers} disabled={speakerState === 'playing'} className="secondary-btn mt-4 w-full !py-2 text-[13px]">
                <Volume2 className="h-4 w-4" />
                {speakerState === 'playing' ? 'Playing test sound…' : speakerState === 'done' ? 'Play speaker test again' : 'Test speakers'}
              </button>
              <p className="mt-2 pb-2 text-center text-xs text-ink-3">Questions are read aloud through your current speakers or headphones.</p>
            </div>
            {permissionError && <div className="px-5 pb-4"><Notice tone="warn">{permissionError}</Notice></div>}
          </Panel>

          <Panel i={3} className="p-5">
            <fieldset>
              <legend className="text-[15px] font-semibold text-ink">How will you answer?</legend>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[['voice', 'Speak', 'Recommended', Mic], ['typed', 'Type', 'No microphone', Keyboard]].map(([value, label, hint, Icon]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer flex-col gap-1 rounded-control border px-3 py-2.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink ${
                      answerMode === value ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink-4'
                    }`}
                  >
                    <input type="radio" name="answer-mode" value={value} checked={answerMode === value} onChange={() => setAnswerMode(value)} className="sr-only" />
                    <span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" aria-hidden="true" />{label}</span>
                    <span className={`text-xs ${answerMode === value ? 'text-paper/60' : 'text-ink-3'}`}>{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-5 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={codingRound}
                onChange={(e) => setCodingChoice(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[#171611]"
              />
              <span className="text-[13px] leading-relaxed text-ink-2">
                <span className="font-medium text-ink">Include a coding round.</span> Questions 2 and 4 open the built-in code editor (VPL) with test cases.
              </span>
            </label>
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[#171611]"
              />
              <span className="text-[13px] leading-relaxed text-ink-2">
                I consent to the whole interview being recorded (camera and microphone), transcribed and analysed, and to integrity monitoring: the interview runs in fullscreen and leaving it is recorded; a photo and a short voice sample are taken at the start and compared with the rest of the interview; other people, phones, other voices and reading a prepared answer are detected.
              </span>
            </label>
            <button onClick={handleContinue} disabled={!canContinue} className="primary-btn mt-5 w-full !py-3">
              Continue to Interview <ArrowRight className="h-4 w-4" />
            </button>
            {!canContinue && (
              <p className="mt-3 text-center text-xs text-ink-3">
                {voiceMode ? 'Camera, microphone, network and consent are required to start.' : 'Camera, network and consent are required to start.'}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
