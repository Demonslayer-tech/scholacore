interface LogoProps {
  className?: string;
}

/**
 * A clean SVG interpretation of the shield-and-arrow mark: shield outline
 * (trust/protection) with an upward arrow through the center (growth/
 * achievement). Single-path, single-color via currentColor, so it inherits
 * text color — e.g. <Logo className="h-8 w-8 text-brand-500" />.
 *
 * This is a hand-built approximation, not a pixel copy of the source PNG
 * logo. Swap in the real logo file under public/ later if a crisper match
 * is needed — this keeps the header/favicon working meanwhile.
 */
export default function Logo({ className = 'h-8 w-8' }: LogoProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M50 6 L88 20 V52 C88 76 72 90 50 96 C28 90 12 76 12 52 V20 Z"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M50 28 L70 54 H58 V74 H42 V54 H30 Z" fill="currentColor" />
    </svg>
  );
}
