import { Brand } from './ui';

// -------------------------------------------------------------
// Frame for the signed-out pages: the form on paper at the left, an ink
// panel with a slowly moving voice waveform and a sample question at the
// right (large screens only).
// -------------------------------------------------------------

// Bar heights for the waveform, as fractions of the full height.
const BARS = [0.28, 0.5, 0.36, 0.72, 0.46, 0.9, 0.6, 0.38, 0.82, 0.55, 0.3, 0.66, 0.94, 0.48, 0.7, 0.34, 0.58, 0.86, 0.42, 0.64, 0.3, 0.76, 0.52, 0.4, 0.68, 0.36, 0.5, 0.26];

function Waveform() {
  return (
    <div className="flex h-24 items-center gap-[5px]" aria-hidden="true">
      {BARS.map((height, index) => (
        <span
          key={index}
          className="wave-bar w-[5px] rounded-full bg-paper/80"
          style={{ height: `${height * 100}%`, '--i': index }}
        />
      ))}
    </div>
  );
}

export default function AuthShell({ title, description, children, footer }) {
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Brand />
        <div className="flex flex-1 items-center py-12">
          <div className="page-enter mx-auto w-full max-w-[380px]">
            <h1 className="font-serif text-[2.75rem] leading-[1.05] text-ink">{title}</h1>
            {description && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{description}</p>}
            <div className="mt-8">{children}</div>
            {footer && <p className="mt-8 text-sm text-ink-3">{footer}</p>}
          </div>
        </div>
        <p className="text-xs text-ink-4">Camera and microphone data stay in your browser during practice.</p>
      </section>

      <aside className="relative hidden overflow-hidden bg-ink p-12 text-paper lg:flex lg:flex-col lg:justify-between">
        {/* Faint grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.045]"
          style={{
            backgroundImage: 'linear-gradient(#f7f6f2 1px, transparent 1px), linear-gradient(90deg, #f7f6f2 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <p className="relative text-[13px] text-paper/55">Practice room</p>

        <div className="relative max-w-lg">
          <div className="reveal rounded-panel border border-paper/15 bg-paper/[0.04] p-6 backdrop-blur-sm" style={{ '--i': 2 }}>
            <div className="flex items-center justify-between text-xs text-paper/55">
              <span>Question 3 of 5 · Follow-up</span>
              <span className="flex items-center gap-2">
                <span className="pulse-dot h-2 w-2 rounded-full bg-[#e0796d]" />
                Recording
              </span>
            </div>
            <p className="mt-4 font-serif text-[1.75rem] leading-snug">
              “You mentioned caching the session data. What happens when two servers disagree about it?”
            </p>
            <div className="mt-6">
              <Waveform />
            </div>
          </div>
          <p className="reveal mt-10 font-serif text-[2.4rem] leading-[1.1]" style={{ '--i': 4 }}>
            Rehearse the conversation,
            <span className="italic text-paper/60"> not the script.</span>
          </p>
          <p className="reveal mt-4 max-w-md text-[15px] leading-relaxed text-paper/60" style={{ '--i': 5 }}>
            Questions adapt to each answer. Every turn is scored against a rubric you can read afterwards.
          </p>
        </div>

        <div className="relative flex gap-10 text-[13px] text-paper/55">
          <span>Adaptive difficulty</span>
          <span>Rubric-based feedback</span>
          <span>Arena practice</span>
        </div>
      </aside>
    </div>
  );
}
