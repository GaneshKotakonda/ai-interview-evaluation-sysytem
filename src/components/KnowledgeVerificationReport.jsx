import { ArrowRight, BrainCircuit, CheckCircle2, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { Badge } from './ui';

const RESULTS = {
  passed: { label: 'PASSED', tone: 'ok' },
  partial: { label: 'PARTIAL', tone: 'warn' },
  failed: { label: 'FAILED', tone: 'bad' },
};
const COUNT_LABELS = { challenges: 'Challenges issued', passed: 'Passed', partial: 'Partial', failed: 'Failed' };
const clock = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};
const eventAnchor = (id) => `integrity-event-${encodeURIComponent(String(id))}`;
const serverTime = (timestamp) => {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} UTC` : null;
};

function VerificationResult({ result }) {
  const display = RESULTS[result?.status];
  if (!display) return <Badge>{result ? 'Awaiting result' : 'Unanswered'}</Badge>;
  const score = typeof result.score === 'number' && Number.isFinite(result.score) ? ` ${result.score}%` : '';
  return <Badge tone={display.tone} className="num font-mono">{display.label}{score}</Badge>;
}

function ChainStep({ number, label, icon: Icon, children, last = false }) {
  return (
    <li className="relative min-w-0 rounded-control border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-ink-3">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="num font-mono text-[10px]">0{number}</span>
      </div>
      <p className="mt-2 text-[11px] font-medium text-ink-3">{label}</p>
      <div className="mt-2 text-[14px] font-semibold leading-snug text-ink">{children}</div>
      {!last && <ArrowRight aria-hidden="true" className="absolute -bottom-5 left-1/2 h-4 w-4 -translate-x-1/2 rotate-90 text-ink-3 md:-right-5 md:bottom-auto md:left-auto md:top-1/2 md:translate-x-0 md:-translate-y-1/2 md:rotate-0" />}
    </li>
  );
}

function ChallengeChain({ challenge, knownQuestions }) {
  const evidence = Array.isArray(challenge.evidence) ? challenge.evidence : [];
  const parent = challenge.parent_question_index;
  const generatedAt = challenge.generated_at && serverTime(challenge.generated_at);
  return (
    <article id={`verification-question-${challenge.question_index}`} className="scroll-mt-6 rounded-control border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink-2">Verification requested · Question {challenge.question_index}</span>
        {parent != null && (knownQuestions.has(parent) ? (
          <a href={`#interview-question-${parent}`} className="text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">Parent question {parent}</a>
        ) : <span className="text-ink-3">Parent question {parent}</span>)}
      </div>
      {challenge.trigger_reason && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{challenge.trigger_reason}</p>}
      <ol aria-label={`Verification chain for question ${challenge.question_index}`} className="mt-4 grid gap-6 md:grid-cols-4">
        <ChainStep number={1} label="Integrity evidence" icon={ShieldAlert}>
          {evidence.length ? <div className="space-y-2">{evidence.map((event, index) => {
            const label = event.event_type === 'phone_detected' ? 'Phone detected' : event.label || 'Evidence requires review';
            const question = event.question_index ?? parent;
            const text = `${label}${question != null ? ` during Q${question}` : ''}`;
            return event.id != null ? (
              <a key={event.id} href={`#${eventAnchor(event.id)}`} className="block underline decoration-line-strong underline-offset-4 hover:text-ink-2">{text}</a>
            ) : <p key={index}>{text}</p>;
          })}</div> : <p>Evidence requires review</p>}
        </ChainStep>
        <ChainStep number={2} label="Verification requested" icon={MessageCircleQuestion}>
          <p>Knowledge Verification Q{challenge.question_index}</p>
        </ChainStep>
        <ChainStep number={3} label="Concept tested" icon={BrainCircuit}>
          <p>{challenge.verification_target || challenge.result?.target || 'Previous answer'}</p>
        </ChainStep>
        <ChainStep number={4} label="Verification result" icon={CheckCircle2} last>
          <VerificationResult result={challenge.result} />
          <p className="mt-2 text-[11px] font-normal text-ink-3">{challenge.result ? 'Raw answer-quality grade' : 'No accepted answer recorded'}</p>
        </ChainStep>
      </ol>
      {challenge.question && <p className="mt-4 text-[13px] leading-relaxed text-ink-2">{challenge.question}</p>}
      {(challenge.policy_version || challenge.challenge_type || challenge.risk_score != null || generatedAt) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink">Review challenge details</summary>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {challenge.challenge_type && <div><dt className="text-ink-3">Challenge type</dt><dd className="mt-1 text-ink-2">{challenge.challenge_type.replaceAll('_', ' ')}</dd></div>}
            {challenge.policy_version && <div><dt className="text-ink-3">Policy version</dt><dd className="mt-1 font-mono text-ink-2">{challenge.policy_version}</dd></div>}
            {challenge.risk_score != null && <div><dt className="text-ink-3">Policy risk score</dt><dd className="mt-1 text-ink-2">{challenge.risk_score}/100{challenge.risk_level ? ` · ${challenge.risk_level}` : ''}</dd></div>}
            {generatedAt && <div><dt className="text-ink-3">Requested at</dt><dd className="mt-1 text-ink-2"><time dateTime={challenge.generated_at}>{generatedAt}</time></dd></div>}
          </dl>
        </details>
      )}
    </article>
  );
}

export default function KnowledgeVerificationReport({ verification, summary, turns = [] }) {
  const details = Array.isArray(verification?.details) ? verification.details : [];
  const knownQuestions = new Set(turns.map((turn) => turn.index));
  const fallbackCounts = {
    challenges: details.length,
    passed: details.filter((challenge) => challenge.result?.status === 'passed').length,
    partial: details.filter((challenge) => challenge.result?.status === 'partial').length,
    failed: details.filter((challenge) => challenge.result?.status === 'failed').length,
  };
  return (
    <section aria-label="Knowledge verification" className="mt-6 border-t border-line pt-5">
      <h3 className="text-[13px] font-semibold text-ink">Knowledge verification</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">Targeted questions check understanding of an earlier answer. A result does not establish or disprove cheating, and recorded evidence remains available for review.</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries(COUNT_LABELS).map(([key, label]) => {
          const count = summary?.[key] ?? verification?.[key] ?? fallbackCounts[key];
          return <div key={key}><dt className="text-xs text-ink-3">{label}</dt><dd className="num mt-1 font-mono text-lg text-ink">{typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : fallbackCounts[key]}</dd></div>;
        })}
      </dl>
      {details.length ? (
        <div className="mt-5 space-y-4">{details.map((challenge) => <ChallengeChain key={challenge.question_index} challenge={challenge} knownQuestions={knownQuestions} />)}</div>
      ) : <p className="mt-4 text-[13px] text-ink-3">{(summary?.challenges ?? verification?.challenges ?? 0) > 0 ? 'Challenge details are unavailable in this report.' : 'No knowledge verification challenges were issued.'}</p>}
    </section>
  );
}

export function IntegrityTimeline({ events, playerRef }) {
  if (!Array.isArray(events) || !events.length) return null;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-[13px] font-semibold text-ink">Evidence timeline</h3>
      <p className="mt-1 text-xs text-ink-3">Recording offsets are shown by part; session and server times identify events without a recording offset.</p>
      <ol aria-label="Integrity and verification timeline" className="mt-3 divide-y divide-line">
        {events.map((event, index) => {
          const recordingTime = event.recording_part != null && event.at_seconds != null;
          const timestamp = event.created_at && serverTime(event.created_at);
          const timeLabel = recordingTime ? `Part ${event.recording_part} · ${clock(event.at_seconds)}` : event.at_seconds != null ? `Session time · ${clock(event.at_seconds)}` : timestamp ? `Server time · ${timestamp}` : null;
          const result = RESULTS[event.status];
          const dot = result ? { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[result.tone] : event.type === 'verification_requested' ? 'bg-ink' : event.major ? 'bg-bad' : 'bg-warn';
          return (
            <li id={event.id != null ? eventAnchor(event.id) : undefined} key={event.id ?? index} className="scroll-mt-6 flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                <span className="text-ink">{event.label}</span>
                {event.question_index != null && <span className="text-ink-3">· question {event.question_index}</span>}
                {event.duration_seconds != null && event.major && <span className="text-ink-3">· {Math.round(event.duration_seconds)} s</span>}
                {result && <VerificationResult result={event} />}
              </div>
              {timeLabel && (playerRef && recordingTime ? (
                <button type="button" aria-label={`Play ${event.label} · ${timeLabel}`} className="num font-mono text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
                  onClick={() => playerRef.current?.play(event.recording_part, Math.max(0, event.at_seconds - 3))}>
                  {timeLabel}
                </button>
              ) : <span className="num font-mono text-xs text-ink-3">{timeLabel}</span>)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
