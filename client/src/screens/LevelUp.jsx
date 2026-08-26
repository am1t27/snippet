// Level-up celebration — full-screen overlay, one per award, dismissed by tap.
// Typographic burst only (✦), per the no-emoji rule.
import { EYEBROW, BTN_AMBER } from "../ui";

// Eight ✦ particles on fixed vectors; --burst-x/y feed the burst keyframe.
const VECTORS = [
  [0, -90], [64, -64], [90, 0], [64, 64], [0, 90], [-64, 64], [-90, 0], [-64, -64],
];

export function LevelUp({ award, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-void/90 px-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Level up. You are now level ${award.level}, rank ${award.rank}.`}
    >
      <div className="animate-levelup w-full max-w-xs border-2 border-amber bg-cabinet">
      <div className="relative px-6 py-8 text-center">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
          {VECTORS.map(([x, y], i) => (
            <span
              key={i}
              className="absolute animate-burst font-marquee text-xl text-amber"
              style={{ "--burst-x": `${x}px`, "--burst-y": `${y}px`, animationDelay: `${120 + i * 30}ms` }}
            >
              ✦
            </span>
          ))}
        </div>
        <p className="font-coin text-xs text-amber">LEVEL UP</p>
        <p className="fs-display mt-4 font-marquee font-black tabular-nums text-bone phosphor">{award.level}</p>
        <p className={`${EYEBROW} mt-3 text-amber`}>{award.rank}</p>
        <p className="mt-4 font-console text-xs text-dim">
          +{award.gained} XP · {award.into} / {award.needed} into this level
        </p>
        <button type="button" onClick={onClose} className={`${BTN_AMBER} mt-6 w-full`}>
          Continue
        </button>
      </div>
      </div>
    </div>
  );
}
