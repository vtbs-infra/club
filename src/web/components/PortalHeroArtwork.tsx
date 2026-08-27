export function PortalHeroArtwork() {
  return (
    <div className="portal-hero-art" aria-hidden="true">
      <svg
        className="portal-hero-illustration"
        focusable="false"
        viewBox="0 0 520 440"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="portal-hero-halo" x1="102" x2="408" y1="74" y2="382">
            <stop offset="0" stopColor="var(--surface)" />
            <stop offset="0.55" stopColor="var(--accent-cool-soft)" />
            <stop offset="1" stopColor="var(--primary-soft)" />
          </linearGradient>
          <linearGradient id="portal-hero-box" x1="175" x2="346" y1="262" y2="372">
            <stop offset="0" stopColor="var(--primary-gradient-start)" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
          <linearGradient id="portal-hero-flap" x1="174" x2="342" y1="202" y2="282">
            <stop offset="0" stopColor="var(--accent-cool)" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
          <linearGradient id="portal-hero-light" x1="260" x2="260" y1="122" y2="278">
            <stop offset="0" stopColor="var(--accent-cool)" stopOpacity="0.52" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="portal-hero-star" x1="235" x2="286" y1="116" y2="170">
            <stop offset="0" stopColor="var(--accent-cool)" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
        </defs>

        <circle className="portal-art-halo" cx="260" cy="220" r="190" />
        <path className="portal-art-orbit" d="M88 238c7-92 82-172 181-177 89-5 168 52 191 134" />
        <circle className="portal-art-dot portal-art-dot-one" cx="91" cy="236" r="4" />
        <circle className="portal-art-dot portal-art-dot-two" cx="462" cy="199" r="4" />

        <g className="portal-art-spark" transform="translate(108 112)">
          <path d="M0-12C1-4 4-1 12 0 4 1 1 4 0 12-1 4-4 1-12 0-4-1-1-4 0-12Z" />
        </g>
        <g className="portal-art-spark portal-art-spark-warm" transform="translate(432 121)">
          <path d="M0-8C1-3 3-1 8 0 3 1 1 3 0 8-1 3-3 1-8 0-3-1-1-3 0-8Z" />
        </g>
        <g className="portal-art-spark portal-art-spark-muted" transform="translate(405 328)">
          <path d="M0-7C1-2 2-1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7Z" />
        </g>

        <path className="portal-art-rising-light" d="m192 270 46-140h44l46 140Z" />
        <path className="portal-art-ribbon" d="M236 249c-27-29-29-58-13-82" />
        <path className="portal-art-ribbon portal-art-ribbon-warm" d="M284 249c28-27 31-54 18-77" />
        <circle className="portal-art-main-glow" cx="260" cy="143" r="52" />
        <g className="portal-art-main-spark" transform="translate(260 143)">
          <path d="M0-30C3-11 11-3 30 0 11 3 3 11 0 30-3 11-11 3-30 0-11-3-3-11 0-30Z" />
        </g>
        <g className="portal-art-floating-spark" transform="translate(207 186)">
          <path d="M0-7C1-2 2-1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7Z" />
        </g>
        <g
          className="portal-art-floating-spark portal-art-floating-spark-warm"
          transform="translate(316 194)"
        >
          <path d="M0-5C1-2 2-1 5 0 2 1 1 2 0 5-1 2-2 1-5 0-2-1-1-2 0-5Z" />
        </g>

        <ellipse className="portal-art-box-shadow" cx="260" cy="378" rx="126" ry="18" />
        <g className="portal-art-box">
          <path className="portal-art-box-interior" d="m151 246 109-43 109 43-109 54Z" />
          <path className="portal-art-flap portal-art-flap-left" d="m151 246 62-62 47 37-64 63Z" />
          <path className="portal-art-flap portal-art-flap-right" d="m369 246-62-62-47 37 64 63Z" />
          <path className="portal-art-box-front" d="M164 258h192l-18 116H182Z" />
          <path className="portal-art-box-side" d="m164 258 96 42v74h-78Z" />
          <path className="portal-art-box-rim" d="m164 258 96 42 96-42" />
          <g className="portal-art-box-mark">
            <path d="M240 316h40v29h-40zM237 316h46M260 316v29" />
            <path d="M260 316c-8 0-14-4-14-9 0-4 3-7 7-7 5 0 7 5 7 16Zm0 0c8 0 14-4 14-9 0-4-3-7-7-7-5 0-7 5-7 16Z" />
          </g>
        </g>
      </svg>
    </div>
  );
}
